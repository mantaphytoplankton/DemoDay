import en from "./messages/en.json" with { type: "json" };

export type MessageKey = keyof typeof en;
export type MessageVars = Record<string, string | number>;

const messages: Record<string, string> = en;

/** Translate a message key, replacing {name} placeholders. Unknown keys return the key so gaps are visible. */
export function t(key: MessageKey, vars?: MessageVars): string {
  const template = messages[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function hasMessage(key: string): key is MessageKey {
  return key in messages;
}
