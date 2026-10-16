// What an imported SVG could not be drawn exactly (D24, D49): every gap is listed, never dropped silently (L26).
// Severity: notDrawn = these parts are missing from the print; approximated = drawn, but differently from a browser;
// info = no visible effect on paper (e.g. animation, scripts).

export type SvgIssueSeverity = 'notDrawn' | 'approximated' | 'info';
export type SvgIssueCode =
  | 'text'
  | 'image'
  | 'foreignObject'
  | 'marker'
  | 'pattern'
  | 'gradient'
  | 'filter'
  | 'mask'
  | 'clipPath'
  | 'groupOpacity'
  | 'useMissing'
  | 'useExternal'
  | 'useRecursive'
  | 'unknownElement'
  | 'cssSelector'
  | 'cssAtRule'
  | 'cssTransform'
  | 'relativeUnit'
  | 'invalidPaint'
  | 'invalidTransform'
  | 'invalidLength'
  | 'pathError'
  | 'nonScalingStroke'
  | 'paintOrder'
  | 'blendMode'
  | 'animation';

export const SVG_ISSUE_SEVERITY: Record<SvgIssueCode, SvgIssueSeverity> = {
  text: 'notDrawn',
  image: 'notDrawn',
  foreignObject: 'notDrawn',
  marker: 'notDrawn',
  pattern: 'notDrawn',
  useMissing: 'notDrawn',
  useExternal: 'notDrawn',
  useRecursive: 'notDrawn',
  unknownElement: 'notDrawn',
  invalidTransform: 'notDrawn',
  gradient: 'approximated',
  filter: 'approximated',
  mask: 'approximated',
  clipPath: 'approximated',
  groupOpacity: 'approximated',
  cssSelector: 'approximated',
  cssAtRule: 'approximated',
  cssTransform: 'approximated',
  relativeUnit: 'approximated',
  invalidPaint: 'approximated',
  invalidLength: 'approximated',
  pathError: 'approximated',
  nonScalingStroke: 'approximated',
  paintOrder: 'approximated',
  blendMode: 'approximated',
  animation: 'info',
};

/** One kind of gap with how often it occurs and up to five examples (element names, ids, selectors). */
export type SvgIssue = { code: SvgIssueCode; severity: SvgIssueSeverity; count: number; examples: string[] };
export type SvgReport = { issues: SvgIssue[]; drawn: number };

export class ReportBuilder {
  private map = new Map<SvgIssueCode, SvgIssue>();
  add(code: SvgIssueCode, example?: string) {
    let i = this.map.get(code);
    if (!i) {
      i = { code, severity: SVG_ISSUE_SEVERITY[code], count: 0, examples: [] };
      this.map.set(code, i);
    }
    i.count++;
    if (example && i.examples.length < 5 && !i.examples.includes(example)) i.examples.push(example.slice(0, 60));
  }
  build(drawn: number): SvgReport {
    const order: SvgIssueSeverity[] = ['notDrawn', 'approximated', 'info'];
    const issues = [...this.map.values()].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || b.count - a.count);
    return { issues, drawn };
  }
}

/** True when the print may differ from the design (anything but info) — the UI shows the list then. */
export const reportHasGaps = (r: SvgReport) => r.issues.some((i) => i.severity !== 'info');
/** True when the recommendation "export a PDF from your design app" applies (parts missing). */
export const reportMissesParts = (r: SvgReport) => r.issues.some((i) => i.severity === 'notDrawn');
