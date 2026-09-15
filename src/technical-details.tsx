import { translate } from "./i18n";

export function TechnicalDetails({ label, value }: { label?: string; value: string }) {
  return <details className="technical-details"><summary>{translate("Technical details")}{label ? ` · ${translate(label)}` : ""}</summary><code>{value}</code></details>;
}
