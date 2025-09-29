import axios, { AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { load as cheerioLoad } from "cheerio";
import { JSDOM } from "jsdom";
import { CookieJar } from "tough-cookie";
import crypto from "crypto";

type Kid = {
  id: number;
  firstName: string;
  lastName: string;
  className: string;
};
type SchoolInfo = {
  key: string;
  value: string;
};
type Termin = {
  id: number;
  title: string;
  title_short: string;
  class: "event-info";
  bo_end: 0 | 1;
  startDate: Date;
  endDate: Date;
};

type TerminListeKategorie = "schulaufgaben" | "allgemein";

type TerminListenEintrag = {
  id: number;
  title: string;
  /** Raw date string as delivered by the Elternportal HTML */
  rawDate: string;
  /** Raw time string (may be empty) as delivered by the Elternportal HTML */
  rawTime: string | null;
  /** Start of the exam/appointment (may include time if available) */
  startDate: Date | null;
  /** End of the exam/appointment (falls back to start for missing information) */
  endDate: Date | null;
  /** Convenience field pointing to startDate to preserve backwards compatibility */
  date: Date | null;
  /** Indicates that the event spans whole days (no explicit time information) */
  allDay: boolean;
  /** Which type of list the entry originated from */
  category: TerminListeKategorie;
};

export type Schulaufgabe = TerminListenEintrag & {
  category: "schulaufgaben";
};

export type AllgemeinerTermin = TerminListenEintrag & {
  category: "allgemein";
};

type ICalAlarmOption = {
  trigger: string;
  description?: string;
  action?: string;
};

export type GenerateICalendarOptions = {
  calendarName: string;
  calendarColor?: string;
  schoolIdentifier: string;
  summaryBuilder?: (entry: TerminListenEintrag, index: number, total: number) => string;
  descriptionBuilder?: (entry: TerminListenEintrag, index: number, total: number) => string;
  uidBuilder?: (entry: TerminListenEintrag, index: number, total: number) => string;
  alarms?:
    | ICalAlarmOption[]
    | ((
        entry: TerminListenEintrag,
        index: number,
        total: number
      ) => ICalAlarmOption[] | undefined);
  timestamp?: Date;
  onEvent?: (entry: TerminListenEintrag, index: number, total: number) => boolean | void;
};
type Elternbrief = {
  id: number;
  readConfirmationId: number | undefined;
  status: string;
  title: string;
  messageText: string;
  classes: string;
  date: string;
  link: string;
};
type ElternPortalApiClientConfig = {
  short: string;
  username: string;
  password: string;
  kidId: number | undefined;
};
type SchwarzesBrettBox = {
  id: number | null;
  archived: Boolean;
  dateStart: string;
  dateEnd: string | null;
  title: string;
  content: string;
  link: string | undefined;
};
export type ElternportalFile = {
  name: string;
  buffer: Buffer;
};
type Vertretung = {
  date: Date;
  period: number;
  originalTeacher: string;
  substituteTeacher: string;
  originalClass: string;
  substituteClass: string;
  room: string;
  note: string;
};
type VertretungsPlan = {
  lastUpdate: Date|undefined,
  substitutions: Vertretung[]
};
// =========
/** gives you a new ElternPortalApiClient instance */
async function getElternportalClient(
  config: ElternPortalApiClientConfig
): Promise<InstanceType<typeof ElternPortalApiClient>> {
  const apiclient = new ElternPortalApiClient(config);
  await apiclient.init();
  return apiclient;
}
class ElternPortalApiClient {
  jar: CookieJar;
  client: AxiosInstance;
  short: string = "";
  username: string = "";
  password: string = "";
  kidId: number = 0;
  csrf: string = "";
  private schulaufgabenPlanCategory: TerminListeKategorie | null = null;
  constructor(config: ElternPortalApiClientConfig) {
    this.short = config.short;
    this.username = config.username;
    this.password = config.password;
    this.kidId = config.kidId || 0;
    //
    this.jar = new CookieJar();
    this.client = wrapper(axios.create({ jar: this.jar }));
  }
  async init() {
    const { data } = await this.client.request({
      method: "GET",
      url: `https://${this.short}.eltern-portal.org/`,
    });
    const $ = cheerioLoad(data);
    const parsedCSRFToken = $(`[name='csrf']`).val() as string;
    this.csrf = parsedCSRFToken;

    await this.setKid(this.kidId);
  }

  async setKid(kidId: number) {
    await this.client.request({
      method: "POST",
      url: `https://${this.short}.eltern-portal.org/includes/project/auth/login.php`,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: {
        csrf: this.csrf,
        username: this.username,
        password: this.password,
        go_to: "",
      },
    });

    const response = await this.client.request({
      method: "POST",
      url: `https://${this.short}.eltern-portal.org/api/set_child.php?id=${kidId}`,
    });

    if (response.data === 1) {
      // console.log("Kid set to:", kidId);
    } else {
      // console.log("Failed to set kid to:", kidId);
    }
  }
  /** list all kids in account */
  async getKids(): Promise<Kid[]> {
    const { data } = await this.client.get(
      `https://${this.short}.eltern-portal.org/start`
    );
    const $ = cheerioLoad(data);
    const kids: Kid[] = [];

    $("select.form-control option").each((_index: number, element) => {
      const id = parseInt($(element).attr("value") || "0");
      const accountRow = $(element).text().trim();
      const firstName = accountRow.split(" ")[0];
      const lastName = accountRow.split(" ")[1];
      const className = accountRow
        .split(" ")[2]
        .replace("(", "")
        .replace(")", "");

      kids.push({ id, firstName, lastName, className });
    });

    return kids;
  }

  /** get array of blackboard items */
  async getSchwarzesBrett(
    includeArchived = false
  ): Promise<SchwarzesBrettBox[]> {
    const { data } = await this.client.get(
      `https://${this.short}.eltern-portal.org/aktuelles/schwarzes_brett`
    );
    const $ = cheerioLoad(data);
    const posts: SchwarzesBrettBox[] = [];

    $(".container .grid-item").each((_index: number, element) => {
      const dateStart = $(element)
        .find(".text-right")
        .text()
        .trim()
        .replace("eingestellt am ", "")
        .replace(" 00:00:00", "")
        .replace(",,", '"');
      const title = $(element).find("h4").text().trim().replace(",,", '"');
      const content = this.htmlToPlainText(
        $(element)
          .find("p:not(.text-right)")
          .map((_i, el) => $(el).html())
          .get()
          .join("<br>")
      );
      const link = $(element).find("a").attr("href");
      const id = parseInt(link?.split("repo=")[1].split("&")[0] ?? "0");

      posts.push({
        id: id == 0 ? this.getIdFromTitle(title) : id,
        dateStart,
        dateEnd: null,
        title,
        content,
        archived: false,
        link,
      });
    });

    if (includeArchived) {
      $(".arch .well").each((_index: number, element) => {
        const link = $(element).find("a").attr("href");
        const id = parseInt(link?.split("?")[1].split("repo")[0] ?? "0");
        const title = $(element).find("h4").text().trim().replace(",,", '"');
        const content = $(element)
          .find(".col-sm-9 p")
          .text()
          .replace(",,", '"');
        const dates = $(element).find(".col-md-2 p").text().trim().split(" - ");
        const dateStart = dates[0];
        const dateEnd = dates[1];

        posts.push({
          id,
          dateStart,
          dateEnd,
          title,
          content,
          archived: true,
          link,
        });
      });
    }

    return posts;
  }
  /** get school infos as key value json array */
  async getSchoolInfos(): Promise<SchoolInfo[]> {
    const { data } = await this.client.get(
      `https://${this.short}.eltern-portal.org/service/schulinformationen`
    );
    const $ = cheerioLoad(data);
    $("table").remove();
    $(".hidden-lg").remove();
    let infos =
      ($("#asam_content").html() as string) || "".replaceAll(`\n`, "<br>");
    const schoolInfos = cheerioLoad(infos)(".row")
      .get()
      .map((ele) => {
        return {
          key: $(ele).find(".col-md-4").text(),
          value: $(ele).find(".col-md-6").html() as string,
        };
      });
    return schoolInfos;
  }

  /** get termine of entire school */
  async getTermine(from = 0, to = 0): Promise<Termin[]> {
    const [param__from, param__to, utc_offset] = this.getFromAndToParams(
      from,
      to
    );
    const { data } = await this.client.request({
      method: "GET",
      url: `https://${this.short}.eltern-portal.org/api/ws_get_termine.php`,
      params: { from: param__from, to: param__to, utc_offset },
    });
    if (data.success === 1) {
      data.result = data.result.map((t: any) => {
        t.title = t.title.replaceAll("<br />", "<br>").replaceAll("<br>", "\n");
        t.title_short = t.title_short
          .replaceAll("<br />", "<br>")
          .replaceAll("<br>", "\n");
        t.startDate = new Date(parseInt(t.start));
        t.endDate = new Date(parseInt(t.end));
        t.bo_end = parseInt(t.bo_end);
        t.id = parseInt(t.id.replace("id_", ""));
        return t;
      });
      data.result = data.result.filter((t: any) => t.start >= param__from);
      data.result = data.result.filter((t: any) => t.end <= param__to);
      return data.result;
    }
    return [];
  }

  async getSchulaufgabenplan(): Promise<Schulaufgabe[]> {
    // Die Terminliste liefert je nach Schule unterschiedliche Tabs. Wir lesen
    // deshalb die Meta-Informationen aus dem Header und geben nur dann
    // Schulaufgaben zurück, wenn der Tab tatsächlich angeboten und aktiv ist.
    const {
      entries,
      activeCategory,
      availableCategories,
    } = await this.fetchTerminListe("schulaufgaben");

    if (!availableCategories.has("schulaufgaben")) {
      this.schulaufgabenPlanCategory = "allgemein";
      return [];
    }

    if (activeCategory !== "schulaufgaben") {
      this.schulaufgabenPlanCategory = activeCategory;
      return [];
    }

    const schulaufgaben = (entries as Schulaufgabe[]).map((entry) => ({
      ...entry,
      category: "schulaufgaben",
    }));

    if (schulaufgaben.length === 0) {
      this.schulaufgabenPlanCategory = "allgemein";
      return [];
    }

    this.schulaufgabenPlanCategory = "schulaufgaben";
    return schulaufgaben;
  }

  async getAllgemeineTermine(): Promise<AllgemeinerTermin[]> {
    const {
      entries,
      availableCategories,
    } = await this.fetchTerminListe("allgemein");

    if (!availableCategories.has("allgemein")) {
      return [];
    }

    return (entries as AllgemeinerTermin[]).map((entry) => ({
      ...entry,
      category: "allgemein",
    }));
  }

  getSchulaufgabenplanStatus(): TerminListeKategorie | null {
    return this.schulaufgabenPlanCategory;
  }

  private async fetchTerminListe(
    requestedCategory: TerminListeKategorie
  ): Promise<{
    entries: TerminListenEintrag[];
    activeCategory: TerminListeKategorie;
    availableCategories: Set<TerminListeKategorie>;
  }>
  {
    const pathSegment =
      requestedCategory === "schulaufgaben" ? "schulaufgaben" : "allgemein";
    const { data } = await this.client.request({
      method: "GET",
      url: `https://${this.short}.eltern-portal.org/service/termine/liste/${pathSegment}#10`,
    });
    const $ = cheerioLoad(data);
    const detection = this.detectTerminListenKategorie(
      $,
      requestedCategory
    );
    const availableCategories = detection.availableCategories;

    let effectiveCategory: TerminListeKategorie = requestedCategory;
    if (availableCategories.has(requestedCategory)) {
      effectiveCategory = requestedCategory;
    } else if (detection.activeCategory) {
      effectiveCategory = detection.activeCategory;
    } else if (availableCategories.size > 0) {
      effectiveCategory = availableCategories.values().next().value as TerminListeKategorie;
    }

    const eintraege = this.parseTerminListe($, effectiveCategory);

    return {
      entries: eintraege,
      activeCategory: detection.activeCategory ?? effectiveCategory,
      availableCategories,
    };
  }

  private sanitizeHtmlCell(value: string): string {
    return value
      .replace(/\r?\n|\t/g, " ")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private extractCellText(cell: any): string {
    const cloned = cell.clone();
    cloned.find("br").replaceWith(" ");
    return this.sanitizeHtmlCell(cloned.text());
  }

  private detectTerminListenKategorie(
    $: ReturnType<typeof cheerioLoad>,
    fallback: TerminListeKategorie
  ): {
    activeCategory: TerminListeKategorie | null;
    availableCategories: Set<TerminListeKategorie>;
  } {
    // Tabs liegen als Button-Gruppe im Header. Darüber lassen sich sowohl die
    // angebotenen Kategorien als auch die aktive Auswahl sicher bestimmen.
    const buttons = $(".calendar_header .btn-group a");
    const availableCategories = new Set<TerminListeKategorie>();
    let active: TerminListeKategorie | null = null;

    buttons.each((_index, element) => {
      const $button = $(element);
      const href = $button.attr("href")?.toLowerCase() ?? "";
      const text = $button.text().toLowerCase();
      const isSchulaufgaben =
        href.includes("/schulaufgaben") || text.includes("schulaufgaben");
      const isAllgemein =
        href.includes("/allgemein") || text.includes("allgemeine");
      const isActive = $button.hasClass("btn-primary");

      if (isSchulaufgaben) {
        availableCategories.add("schulaufgaben");
        if (isActive) {
          active = "schulaufgaben";
        }
      }

      if (isAllgemein) {
        availableCategories.add("allgemein");
        if (isActive) {
          active = "allgemein";
        }
      }
    });

    if (!active && availableCategories.has(fallback)) {
      active = fallback;
    }

    if (!active && availableCategories.size === 1) {
      active = availableCategories.values().next().value as TerminListeKategorie;
    }

    return { activeCategory: active, availableCategories };
  }

  private parseTerminListe(
    $: ReturnType<typeof cheerioLoad>,
    category: TerminListeKategorie
  ): TerminListenEintrag[] {
    const eintraege: TerminListenEintrag[] = [];

    $(".container #asam_content .row .no_padding_md .table2 tbody tr").each(
      (_index, element) => {
        const cells = $(element).find("td");
        const rawDate = this.extractCellText(cells.eq(0));
        const rawTime = this.extractCellText(cells.eq(1));
        const title = this.extractCellText(cells.eq(2));

        if (!title) {
          return;
        }

        const { startDate, endDate, allDay } = this.parseSchulaufgabeDateTime(
          rawDate,
          rawTime
        );

        const eintrag: TerminListenEintrag = {
          id: this.getIdFromTitle(`${title}-${rawDate}-${rawTime ?? ""}`),
          title,
          rawDate,
          rawTime: rawTime || null,
          startDate,
          endDate,
          date: startDate,
          allDay,
          category,
        };

        eintraege.push(eintrag);
      }
    );

    return eintraege;
  }

  private parseSchulaufgabeDateTime(
    dateText: string,
    timeText: string
  ): { startDate: Date | null; endDate: Date | null; allDay: boolean } {
    const normalizedDate = dateText.trim();
    const normalizedTime = timeText.trim();

    if (!normalizedDate) {
      return { startDate: null, endDate: null, allDay: true };
    }

    const dateParts = normalizedDate
      .split(/(?:-|–|—|bis)/i)
      .map((part) => part.trim())
      .filter(Boolean);

    const startDateParts = this.parseGermanDate(dateParts[0]);
    if (!startDateParts) {
      return { startDate: null, endDate: null, allDay: true };
    }

    const endDateParts =
      dateParts.length > 1
        ? this.parseGermanDate(dateParts[dateParts.length - 1]) ?? startDateParts
        : startDateParts;

    const timeParts = normalizedTime
      ? normalizedTime
          .split(/(?:-|–|—|bis)/i)
          .map((part) => part.trim())
          .filter(Boolean)
      : [];

    const startTime = timeParts.length > 0 ? this.parseTime(timeParts[0]) : null;
    const endTime =
      timeParts.length > 1
        ? this.parseTime(timeParts[timeParts.length - 1])
        : null;

    const startDate = new Date(
      startDateParts.year,
      startDateParts.month - 1,
      startDateParts.day,
      startTime?.hours ?? 0,
      startTime?.minutes ?? 0,
      0,
      0
    );

    let allDay = !startTime && !endTime;
    let endDate: Date | null = null;

    if (dateParts.length > 1) {
      if (endTime) {
        endDate = new Date(
          endDateParts.year,
          endDateParts.month - 1,
          endDateParts.day,
          endTime.hours,
          endTime.minutes,
          0,
          0
        );
        allDay = false;
      } else {
        endDate = new Date(
          endDateParts.year,
          endDateParts.month - 1,
          endDateParts.day,
          23,
          59,
          59,
          999
        );
        allDay = true;
      }
    } else if (endTime) {
      endDate = new Date(
        startDateParts.year,
        startDateParts.month - 1,
        startDateParts.day,
        endTime.hours,
        endTime.minutes,
        0,
        0
      );
      if (endDate.getTime() <= startDate.getTime()) {
        endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      }
    } else if (startTime) {
      endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
    } else {
      endDate = new Date(
        startDateParts.year,
        startDateParts.month - 1,
        startDateParts.day,
        23,
        59,
        59,
        999
      );
      allDay = true;
    }

    return { startDate, endDate, allDay };
  }

  private parseGermanDate(
    value: string
  ): { day: number; month: number; year: number } | null {
    const match = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (!match) {
      return null;
    }
    const [, day, month, year] = match;
    return {
      day: parseInt(day, 10),
      month: parseInt(month, 10),
      year: parseInt(year, 10),
    };
  }

  private parseTime(value: string): { hours: number; minutes: number } | null {
    const match = value.match(/(\d{1,2}):(\d{2})/);
    if (!match) {
      return null;
    }
    const [, hours, minutes] = match;
    return {
      hours: parseInt(hours, 10),
      minutes: parseInt(minutes, 10),
    };
  }

  private getFromAndToParams(from = 0, to = 0): [number, number, number] {
    const now = Date.now();
    const utc_offset = new Date().getTimezoneOffset();
    let param__from = from;
    if (param__from === 0) {
      param__from = now;
    }
    let param__to = to;
    if (param__to === 0) {
      param__to = now + 1000 * 60 * 60 * 24 * 90;
    }
    //
    if (`${from}`.length !== 13) {
      param__from = parseInt(`${param__from}`.padEnd(13, "0"));
    }
    if (`${to}`.length !== 13) {
      param__to = parseInt(`${param__to}`.padEnd(13, "0"));
    }

    return [param__from, param__to, utc_offset];
  }
  /** get timetable of currently selected kid */
  async getStundenplan(): Promise<any> {
    const { data } = await this.client.get(
      `https://${this.short}.eltern-portal.org/service/stundenplan`
    );
    const $ = cheerioLoad(data);
    const tmp = $("#asam_content > div > table > tbody tr td");
    // @ts-ignore
    let rows = [];
    let std = 0;
    tmp.each((_index: number, element) => {
      // replace <br> with \n to catch all versions 
      $(element).find("br").replaceWith("\n");
      const values = $(element).text().split("\n");

      if ($(element).attr("width") == "15%") {
        const value = parseInt(values[0]);
        std = value
        const detail = (values[1] || "").replaceAll(".", ":");
          rows.push({ type: "info", value, detail, std });
        } else {
        const value = (values[0] || "");
        const detail = (values[1] || "");
          rows.push({ type: "class", value, detail, std });
        }
    });
    // @ts-ignore
    rows = rows.filter((r) => r.std !== null);
    // @ts-ignore
    return rows;
  }
  /** get substitutions */
  async getVertretungsplan(): Promise<VertretungsPlan> {
    const { data } = await this.client.request({
      method: "GET",
      url: `https://${this.short}.eltern-portal.org/service/vertretungsplan`,
    });
    const $ = cheerioLoad(data);

    const lastUpdate = $('div.main_center div:contains("Stand:")').text();
    const dateTimeMatch = lastUpdate.match(/Stand:\s(\d{2}\.\d{2}\.\d{4})\s(\d{2}:\d{2}:\d{2})/);
    let jsDate : Date|undefined = undefined;
    if (dateTimeMatch) {
      const [_, datePart, timePart] = dateTimeMatch;

      // Convert to a JavaScript Date object
      const [day, month, year] = datePart.split('.').map(Number);
      const [hours, minutes, seconds] = timePart.split(':').map(Number);
      jsDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
    }


    const vertretungsplan: VertretungsPlan = {
      lastUpdate: jsDate,
      substitutions: []
    };

    const normalizeHeader = (value: string) =>
      value
        .replace(/\u00a0/g, " ")
        .replace(/[\.\s]+/g, "")
        .toLowerCase();

    $('div.main_center div.list.bold:contains("KW")').each((_index, element) => {
      const $element = $(element);
      const datestring = $element.text();

      const match = datestring.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (!match || match.length != 4) {
        // Skip malformed headers but continue with the remaining days.
        return;
      }
      // Use UTC so that JSON serialisation does not shift the calendar day.
      const substitutionDate = new Date(Date.UTC(+match[3], +match[2] - 1, +match[1]));

      // find matching table
      const table = $element.nextAll("table").first();
      if (!table || table.length === 0) {
        // No table following the header – move on to the next header.
        return;
      }

      // row might contain note about 'Keine Vertretungen'
      if (table.has('tr:nth-child(2) td[align=center]:contains(Keine Vertretungen)').length > 0) {
        // The day explicitly states there are no substitutions; skip but keep iterating.
        return;
      }

      const headerRow = table.find("tr.vp_plan_head").first();
      const headerCells = headerRow.find("td");
      const columnIndex = new Map<string, number>();
      headerCells.each((cellIndex, cell) => {
        const key = normalizeHeader($(cell).text());
        if (key) {
          columnIndex.set(key, cellIndex);
        }
      });

      const getIndex = (key: string, fallback: number | null = null) =>
        columnIndex.has(key) ? columnIndex.get(key)! : fallback;

      const sanitizeText = (value: string) =>
        value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

      const periodIndex = getIndex("std", 0);
      const originalTeacherIndex = getIndex("betrifft", null);
      const substituteTeacherIndex = columnIndex.has("vertretung")
        ? columnIndex.get("vertretung")!
        : originalTeacherIndex;
      const subjectIndex = getIndex("fach", null);
      const roomIndex = getIndex("raum", null);
      const infoIndex = getIndex("info", null);

      table.find('tr:not(.vp_plan_head)').each((_rowIndex, element) => {
        const $element = $(element);
        const cells = $element.find("td");
        if (!cells || cells.length === 0) {
          return;
        }

        const getCellText = (index: number | null | undefined) => {
          if (index == null || index < 0 || index >= cells.length) {
            return "";
          }
          return sanitizeText($(cells.get(index)).text());
        };

        const subjectCell = subjectIndex != null && subjectIndex >= 0 && subjectIndex < cells.length
          ? $(cells.get(subjectIndex))
          : null;

        let substituteSubject = "";
        let originalSubject = "";

        if (subjectCell && subjectCell.length > 0) {
          const substituteSubjectRaw = subjectCell
            .clone()
            .find("span")
            .remove()
            .end()
            .text();
          substituteSubject = sanitizeText(substituteSubjectRaw);
          if (substituteSubject.includes(" ")) {
            const tokens = substituteSubject.split(/\s+/).filter(Boolean);
            if (tokens.length > 0) {
              substituteSubject = tokens[tokens.length - 1];
            }
          }

          const originalSubjectRaw = subjectCell.find("span").first().text();
          const originalSubjectProcessed = sanitizeText(originalSubjectRaw);
          subjectCell.find("span").remove();
          originalSubject = originalSubjectProcessed || sanitizeText(subjectCell.text());
        }

        const periodRaw = getCellText(periodIndex);
        const period = Number.parseInt(periodRaw, 10);

        vertretungsplan.substitutions.push({
          date: substitutionDate,
          period: Number.isNaN(period) ? 0 : period,
          originalTeacher: getCellText(originalTeacherIndex),
          substituteTeacher: getCellText(substituteTeacherIndex),
          originalClass: originalSubject || substituteSubject,
          substituteClass: substituteSubject || originalSubject,
          room: getCellText(roomIndex),
          note: getCellText(infoIndex)
        });
      });
    });
    return vertretungsplan;
  }  
  /** get lost and found items */
  async getFundsachen(): Promise<string[]> {
    const { data } = await this.client.get(
      `https://${this.short}.eltern-portal.org/suche/fundsachen`
    );
    const $ = cheerioLoad(data);
    $("table").remove();
    $(".hidden-lg").remove();
    let fundsachenhtml = ($("#asam_content").html() as string).replaceAll(
      `\n`,
      "<br>"
    );
    const fundsachen = cheerioLoad(fundsachenhtml)(".row")
      .get()
      .map((ele: any) => {
        return $(ele).find(".caption").text();
      })
      .filter((f) => f.trim());
    return fundsachen;
  }
  /** get parents letters */
  async getElternbriefe(): Promise<Elternbrief[]> {
    const { data } = await this.client.get(
      `https://${this.short}.eltern-portal.org/aktuelles/elternbriefe`
    );
    const $ = cheerioLoad(data);
    $(".hidden-lg").remove();
    let tmp = $("tr")
      .get()
      .map((ele) => {
        if (($(ele).find("td:first").html() as string).includes("<h4>")) {
          
          // Suche nach onclick in a oder span
          const clickElement = $(ele).find("[onclick*='eb_bestaetigung']");
          const readConfirmationStringId = clickElement.attr("onclick")
          ?.match(/eb_bestaetigung\((\d+)\)/)![1] ?? undefined;

          const readConfirmationId = readConfirmationStringId
            ? parseInt(readConfirmationStringId)
            : undefined;

          // Prüfe, ob es ein a-Element gibt oder nur ein span
          const hasLink = $(ele).find("td:first a").length > 0;
              
          // Extrahiere Titel - entweder aus a h4 oder aus span h4
          const title = hasLink 
            ? $(ele).find("td:first a h4").text() 
            : $(ele).find("td:first span h4").text();


          $(ele).remove("h4");

          const messageText = $(ele)
            .find("td:first")
            .clone()
            .children()
            .remove()
            .end()
            .text()
            .trim();

          const classes = $(ele)
            .find("span[style='font-size: 8pt;']")
            .text()
            .replace("Klasse/n: ", "");

          // Link nur, wenn a-Element existiert
          const link = hasLink ? $(ele).find("td:first a").attr("href") : "";
            
          // Datum entweder aus a oder aus span
          let date = "";
          if (hasLink) {
            date = $(ele)
              .find("td:first a")
              .text()
              .replace(`${title} `, "");
          } else {
            date = $(ele)
              .find("td:first span.link_nachrichten")
              .text()
              .replace(`${title} `, "")
              .replace(/\(.*?\)/g, "") // Entferne Text in Klammern
              .trim();
          }

          $(ele).remove("a");
          return {
            readConfirmationId,
            title,
            messageText,
            classes,
            date,
            link,
          };
        }
        const statusOriginal = $(ele).find("td:last").html() as string;
        let status = "read";
        if (statusOriginal.includes("noch nicht")) {
          status = "unread";
        }
        return {
          id: $(ele).find("td:first").html(),
          status,
        };
      });
    let briefe: Elternbrief[] = [];
    for (let index = 0; index < tmp.length; index += 2) {
      briefe.push({
        id: parseInt((tmp[index].id as string).replace("#", "")),
        readConfirmationId: tmp[index + 1].readConfirmationId,
        status: tmp[index].status ?? "unread",
        title: tmp[index + 1].title ?? "",
        messageText: tmp[index + 1].messageText ?? "",
        classes: tmp[index + 1].classes ?? "",
        date: tmp[index + 1].date ?? "",
        link: tmp[index + 1].link ?? "",
      });
    }

    return briefe;
  }

  async getSchwarzesBrettFile(id: number): Promise<ElternportalFile> {
    const schwarzesBrett = await this.getSchwarzesBrett();
    const entry = schwarzesBrett.find((entry) => entry.id === id);

    if (!entry || !entry.link) {
      throw new Error("File from Schwarzesbrett not found");
    }

    const buffer = await this.getFileBuffer(entry?.link ?? "");

    const file = {
      name: entry.title,
      buffer,
    };
    return file;
  }

  async getElternbrief(
    id: number,
    validateElternbriefReceipt: boolean = true
  ): Promise<ElternportalFile> {
    const elternbriefe = await this.getElternbriefe();
    const brief = elternbriefe.find((brief) => brief.id === id);

    if (!brief || !brief.link) {
      throw new Error("Elternbrief not found");
    }

    const buffer = await this.getFileBuffer(brief?.link ?? "");

    if (validateElternbriefReceipt) {
      await this.validateElternbriefReceipt(brief);
    }

    const file = {
      name: brief.title,
      buffer,
    };
    return file;
  }

  private async validateElternbriefReceipt(elternbrief: Elternbrief) {
    if (elternbrief.readConfirmationId) {
      await this.client.get(
        `https://${this.short}.eltern-portal.org/api/elternbrief_bestaetigen.php?eb=${elternbrief.readConfirmationId}`
      );
    }
  }

  private async getFileBuffer(link: string): Promise<Buffer> {
    const downloadUrl = `https://${this.short}.eltern-portal.org/${link}`;
    const response = await this.client.get(downloadUrl, {
      responseType: "arraybuffer",
    });
    const buffer = Buffer.from(response.data, "binary");
    return buffer;
  }

  private getIdFromTitle(title: string): number {
    let hash = 5381;
    for (let i = 0; i < title.length; i++) {
      hash = (hash * 33) ^ title.charCodeAt(i); // Multipliziere den Hash und XOR mit dem aktuellen Zeichen
    }
    return hash >>> 0; // Umwandlung in eine positive Ganzzahl
  }

  toDate(dateString: string): Date {
    const [day, month, year] = dateString.split(".").map(Number);
    return new Date(year, month - 1, day);
  }

  // timestamp to date
  timestampToDate(timestamp: number): Date {
    return new Date(timestamp);
  }

  private htmlToPlainText(html: string): string {
    const dom = new JSDOM(html);
    return dom.window.document.body.textContent || "";
  }
}
// =========
function formatDateTimeForICS(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  const seconds = `${date.getSeconds()}`.padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function formatDateOnlyForICS(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
  return next;
}

function sanitizeICalText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function generateICalendar(
  entries: TerminListenEintrag[],
  options: GenerateICalendarOptions
): { ics: string; count: number } {
  const {
    calendarName,
    calendarColor = "#FF9500",
    schoolIdentifier,
    summaryBuilder,
    descriptionBuilder,
    uidBuilder,
    alarms,
    timestamp,
    onEvent,
  } = options;

  const now = timestamp ?? new Date();
  const dtstamp = formatDateTimeForICS(now);
  const total = entries.length;

  let icsContent =
    "BEGIN:VCALENDAR\r\n" +
    "VERSION:2.0\r\n" +
    "PRODID:-//Elternportal//Kalenderexport//DE\r\n" +
    "METHOD:PUBLISH\r\n" +
    `X-WR-CALNAME:${sanitizeICalText(calendarName)}\r\n` +
    `X-APPLE-CALENDAR-COLOR:${calendarColor}\r\n`;

  let exportedCount = 0;

  entries.forEach((entry, index) => {
    if (!entry.startDate || !entry.endDate) {
      return;
    }

    if (onEvent) {
      const include = onEvent(entry, index, total);
      if (include === false) {
        return;
      }
    }

    const startDate = entry.startDate;
    const endDate = entry.endDate;
    const allDay = entry.allDay;

    const summary = summaryBuilder
      ? summaryBuilder(entry, index, total)
      : entry.title;
    const description = descriptionBuilder
      ? descriptionBuilder(entry, index, total)
      : entry.title;

    const uidSeed = uidBuilder
      ? uidBuilder(entry, index, total)
      : `${schoolIdentifier}-${entry.id}-${entry.title}-${startDate.toISOString()}-${endDate.toISOString()}`;
    const uidHash = crypto.createHash("md5").update(uidSeed).digest("hex");
    const uid = `${uidHash}@${schoolIdentifier}.elternportal`;

    icsContent += "BEGIN:VEVENT\r\n";
    icsContent += `UID:${uid}\r\n`;
    icsContent += `DTSTAMP:${dtstamp}\r\n`;

    if (allDay) {
      const startDateValue = formatDateOnlyForICS(startDate);
      const endExclusive = addDays(endDate, 1);
      icsContent += `DTSTART;VALUE=DATE:${startDateValue}\r\n`;
      icsContent += `DTEND;VALUE=DATE:${formatDateOnlyForICS(endExclusive)}\r\n`;
    } else {
      icsContent += `DTSTART;VALUE=DATE-TIME:${formatDateTimeForICS(startDate)}\r\n`;
      icsContent += `DTEND;VALUE=DATE-TIME:${formatDateTimeForICS(endDate)}\r\n`;
    }

    icsContent += `SUMMARY:${sanitizeICalText(summary)}\r\n`;
    icsContent += `DESCRIPTION:${sanitizeICalText(description)}\r\n`;
    icsContent += "TRANSP:OPAQUE\r\n";
    icsContent += "STATUS:CONFIRMED\r\n";

    const alarmList =
      typeof alarms === "function" ? alarms(entry, index, total) ?? [] : alarms ?? [];

    alarmList.forEach((alarm) => {
      const action = alarm.action || "DISPLAY";
      icsContent += "BEGIN:VALARM\r\n";
      icsContent += `ACTION:${action}\r\n`;
      if (alarm.description) {
        icsContent += `DESCRIPTION:${sanitizeICalText(alarm.description)}\r\n`;
      }
      icsContent += `TRIGGER:${alarm.trigger}\r\n`;
      icsContent += "END:VALARM\r\n";
    });

    icsContent += "END:VEVENT\r\n";
    exportedCount++;
  });

  icsContent += "END:VCALENDAR";

  return { ics: icsContent, count: exportedCount };
}

export { ElternPortalApiClient, getElternportalClient };
