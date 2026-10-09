import { strToU8, zipSync } from "fflate";

/*
 * A small Excel (.xlsx) writer: the parts of SpreadsheetML that reports need
 * (sheets of typed cells, number and date formats, bold totals, a coloured
 * header row, column widths, frozen header and filter buttons), zipped with
 * fflate. Strings are written inline, so cell text is never read as a formula.
 */

export type XlsxStyle =
  | "default"
  | "title"
  | "note"
  | "header"
  | "bold"
  | "indent"
  | "int"
  | "money"
  | "percent"
  | "date"
  | "month"
  | "totalText"
  | "totalInt"
  | "totalMoney"
  | "totalPercent";

/** A number (percent: 0.125 = 12.5%; date / month: a Date) or text; null leaves the cell empty. */
export type XlsxValue = string | number | Date | null;

export type XlsxCell = { value: XlsxValue; style?: XlsxStyle };

export type XlsxSheet = {
  name: string;
  rows: XlsxCell[][];
  /** Column widths in characters. */
  widths?: number[];
  /** Keeps rows 1..n in view while scrolling. */
  freezeRows?: number;
  /** Filter buttons over a block of rows (1-based, inclusive), header row first. */
  filter?: { firstRow: number; lastRow: number; columns: number };
};

export type XlsxOptions = {
  title?: string;
  creator?: string;
  created?: Date;
  /** Header row colour, "#0B3D2E". */
  headerColor?: string;
};

const STYLE_INDEX: Record<XlsxStyle, number> = {
  default: 0,
  title: 1,
  note: 2,
  header: 3,
  bold: 4,
  indent: 5,
  int: 6,
  money: 7,
  percent: 8,
  date: 9,
  month: 10,
  totalText: 11,
  totalInt: 12,
  totalMoney: 13,
  totalPercent: 14,
};

/** Text Excel can hold: no control characters or lone surrogates, at most 32,767 characters. */
export function cleanXmlText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "")
    .slice(0, 32_767);
}

function esc(text: string): string {
  return cleanXmlText(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Column letters: 1 = A, 27 = AA. */
export function columnName(index: number): string {
  let n = index;
  let name = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Excel's day number for a calendar day (1900 date system). */
export function excelDate(date: Date): number {
  const utcDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return (utcDay - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/**
 * A sheet name Excel accepts: no []:*?/\ characters, at most 31 characters,
 * not blank, and unique in the workbook (a number is added when taken).
 */
export function sheetName(wanted: string, taken: Set<string>): string {
  const base =
    cleanXmlText(wanted)
      .replace(/[[\]:*?/\\]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^'+|'+$/g, "")
      .trim()
      .slice(0, 31)
      .trim() || "Sheet";
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    name = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
  }
  taken.add(name.toLowerCase());
  return name;
}

function cellXml(ref: string, cell: XlsxCell): string {
  const s = STYLE_INDEX[cell.style ?? "default"];
  const style = s === 0 ? "" : ` s="${s}"`;
  const { value } = cell;
  if (value === null || value === "") return style ? `<c r="${ref}"${style}/>` : "";
  if (value instanceof Date) return `<c r="${ref}"${style}><v>${excelDate(value)}</v></c>`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return style ? `<c r="${ref}"${style}/>` : "";
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row.map((cell, c) => cellXml(`${columnName(c + 1)}${r + 1}`, cell)).join("");
      return cells ? `<row r="${r + 1}">${cells}</row>` : "";
    })
    .join("");
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths
        .map(
          (w, i) =>
            `<col min="${i + 1}" max="${i + 1}" width="${Math.min(Math.max(w, 4), 80).toFixed(2)}" customWidth="1"/>`,
        )
        .join("")}</cols>`
    : "";
  const frozen = sheet.freezeRows
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sheet.freezeRows + 1}" sqref="A${sheet.freezeRows + 1}"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const filter = sheet.filter ? `<autoFilter ref="${filterRef(sheet.filter)}"/>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `${frozen}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${filter}` +
    `<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `</worksheet>`
  );
}

function filterRef(f: NonNullable<XlsxSheet["filter"]>, absolute = false): string {
  const d = absolute ? "$" : "";
  return `${d}A${d}${f.firstRow}:${d}${columnName(f.columns)}${d}${f.lastRow}`;
}

function hexColor(color: string | undefined): string {
  const hex = (color ?? "").replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(hex) ? `FF${hex.toUpperCase()}` : "FF0B3D2E";
}

function stylesXml(headerColor: string): string {
  const font = (inner: string) => `<font>${inner}<name val="Calibri"/><family val="2"/></font>`;
  const xf = (numFmtId: number, fontId: number, fillId = 0, borderId = 0, align = "") =>
    `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
    `${numFmtId ? ' applyNumberFormat="1"' : ""}${fontId ? ' applyFont="1"' : ""}` +
    `${fillId ? ' applyFill="1"' : ""}${borderId ? ' applyBorder="1"' : ""}` +
    (align ? ` applyAlignment="1"><alignment ${align}/></xf>` : "/>");
  // Order matches STYLE_INDEX. Fonts: 0 normal, 1 bold, 2 title, 3 note, 4 header.
  const cellXfs = [
    xf(0, 0), // default
    xf(0, 2), // title
    xf(0, 3), // note
    xf(0, 4, 2, 0, 'vertical="center" wrapText="1"'), // header
    xf(0, 1), // bold
    xf(0, 0, 0, 0, 'indent="1"'), // indent
    xf(3, 0), // int #,##0
    xf(4, 0), // money #,##0.00
    xf(166, 0), // percent 0.0%
    xf(164, 0, 0, 0, 'horizontal="left"'), // date
    xf(165, 0, 0, 0, 'horizontal="left"'), // month
    xf(0, 1, 0, 1), // total text
    xf(3, 1, 0, 1), // total int
    xf(4, 1, 0, 1), // total money
    xf(166, 1, 0, 1), // total percent
  ];
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="3"><numFmt numFmtId="164" formatCode="d mmm yyyy"/><numFmt numFmtId="165" formatCode="mmm yyyy"/><numFmt numFmtId="166" formatCode="0.0%"/></numFmts>` +
    `<fonts count="5">${[
      font(`<sz val="11"/>`),
      font(`<b/><sz val="11"/>`),
      font(`<b/><sz val="14"/><color rgb="${headerColor}"/>`),
      font(`<i/><sz val="10"/><color rgb="FF666666"/>`),
      font(`<b/><sz val="11"/><color rgb="FFFFFFFF"/>`),
    ].join("")}</fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="${headerColor}"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left/><right/><top style="thin"><color rgb="FF808080"/></top><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${cellXfs.length}">${cellXfs.join("")}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

/** Builds the .xlsx file. */
export function buildXlsx(sheets: XlsxSheet[], options: XlsxOptions = {}): Uint8Array {
  if (sheets.length === 0) throw new Error("A workbook needs at least one sheet.");
  const created = options.created ?? new Date();
  const taken = new Set<string>();
  const named = sheets.map((s) => ({ ...s, name: sheetName(s.name, taken) }));

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    named
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `</Types>`;
  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
    `</Relationships>`;
  const core =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    (options.title ? `<dc:title>${esc(options.title)}</dc:title>` : "") +
    (options.creator ? `<dc:creator>${esc(options.creator)}</dc:creator>` : "") +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${created.toISOString().replace(/\.\d{3}Z$/, "Z")}</dcterms:created>` +
    `</cp:coreProperties>`;
  const app =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Extas ERP</Application></Properties>`;
  const filters = named
    .map((s, i) =>
      s.filter
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name.replace(/'/g, "''"))}'!${filterRef(s.filter, true)}</definedName>`
        : "",
    )
    .join("");
  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<bookViews><workbookView/></bookViews><sheets>` +
    named
      .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("") +
    `</sheets>${filters ? `<definedNames>${filters}</definedNames>` : ""}</workbook>`;
  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    named
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "docProps/core.xml": strToU8(core),
    "docProps/app.xml": strToU8(app),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
    "xl/styles.xml": strToU8(stylesXml(hexColor(options.headerColor))),
  };
  named.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  return zipSync(files, { level: 6, mtime: created });
}
