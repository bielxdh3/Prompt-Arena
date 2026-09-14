import { translate } from "./i18n";

export function HumanError({ summary, detail }: { summary: string; detail: string }) {
  return <div role="alert"><p>{translate(summary)}</p><details><summary>{translate("Technical details")}</summary><pre className="human-error-detail">{detail}</pre></details></div>;
}
