import { PT_BR_MESSAGES, translate } from "./i18n";

export function HumanError({ summary, detail }: { summary: string; detail: string }) {
  return <div role="alert"><p>{translate(summary)}</p><details><summary>{translate("Technical details")}</summary><pre className="human-error-detail">{detail}</pre></details></div>;
}

export function FormFeedback({ kind, message }: { kind: "success" | "info" | "error"; message: string }) {
  const knownMessage = Object.hasOwn(PT_BR_MESSAGES, message);
  return <div className={`form-feedback form-feedback-${kind}`} role={kind === "error" ? undefined : "status"}>
    {kind === "error" ? <HumanError summary={knownMessage ? message : "The action could not be completed. Review the details and try again."} detail={message} /> : translate(message)}
  </div>;
}
