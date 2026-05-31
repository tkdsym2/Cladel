import { useSettingsStore } from "../store/settingsStore";
import type { AppLanguage } from "../types";

/**
 * Lightweight i18n: a flat key → { en, ja } dictionary plus `{var}`
 * interpolation. The active language comes from UI preferences (default "en"),
 * so the app reads as English unless the user switches in Settings.
 *
 * To localize new UI, add keys here and use `useT()` in the component.
 */
export type Entry = { en: string; ja: string };

const STRINGS = {
  // ─── Common ───
  "common.title": { en: "Title", ja: "タイトル" },
  "common.loading": { en: "Loading…", ja: "読込中..." },
  "common.copy": { en: "Copy", ja: "コピー" },
  "common.copied": { en: "Copied", ja: "コピー済み" },

  // ─── Table node (canvas) ───
  "table.badge.imported": { en: "Imported", ja: "取込" },
  "table.badge.manual": { en: "Manual", ja: "手入力" },
  "table.badge.unconfigured": { en: "Not set", ja: "未設定" },
  "table.node.unconfiguredHint": {
    en: "Choose “Create new” or “Import file” in the right panel",
    ja: "右パネルで「新規作成」または「ファイル読込」を選択",
  },

  // ─── Table node viewer (detail panel) ───
  "table.mode.manualEditable": { en: "Manual (editable)", ja: "手入力 (編集可)" },
  "table.mode.importedReadonly": { en: "Imported (read-only)", ja: "取込 (読み取り専用)" },
  "table.action.reload": { en: "Reload latest", ja: "最新状態に更新" },
  "table.action.replaceFile": { en: "Choose another file", ja: "別のファイルを選択" },
  "table.tip.noStoredPath": { en: "No stored path", ja: "保存されたパスがありません" },
  "table.action.copyRefTitle": { en: "Copy reference", ja: "参照をコピー" },
  "table.refHint": {
    en: "Select a cell to copy its citation reference {@{id}[row,col]}",
    ja: "セルを選択すると引用参照 {@{id}[行,列]} をコピーできます",
  },
  "table.action.deleteRow": { en: "Delete row", ja: "行を削除" },
  "table.action.deleteColumn": { en: "Delete column", ja: "列を削除" },
  "table.action.addRow": { en: "Add row", ja: "行を追加" },
  "table.action.addColumn": { en: "Add column", ja: "列を追加" },

  // ─── Table chooser (unconfigured) ───
  "table.chooser.hint": {
    en: "Choose how to create this table.",
    ja: "このテーブルの作成方法を選択してください。",
  },
  "table.chooser.createNew": { en: "Create new", ja: "新規作成" },
  "table.chooser.importFile": { en: "Import existing file", ja: "既存ファイルを読み込む" },
  "table.chooser.createNewDesc": {
    en: "An editable {rows}×{cols} table",
    ja: "{rows}×{cols} の編集可能な表",
  },
  "table.chooser.importFileDesc": {
    en: "CSV / XLSX (read-only, reference only)",
    ja: "CSV / XLSX(編集不可・参照のみ)",
  },

  // ─── Settings ───
  "settings.language": { en: "Language", ja: "言語" },
} satisfies Record<string, Entry>;

export type I18nKey = keyof typeof STRINGS;

export type TVars = Record<string, string | number>;

function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Translate a key for an explicit language (non-hook contexts). */
export function translate(key: I18nKey, lang: AppLanguage, vars?: TVars): string {
  const entry = STRINGS[key];
  return interpolate(entry[lang] ?? entry.en, vars);
}

/** Read the active UI language from settings (default "en"). */
export function useLang(): AppLanguage {
  return useSettingsStore((s) => (s.uiPreferences.language === "ja" ? "ja" : "en"));
}

/**
 * Hook returning a translate function bound to the active language.
 *
 * Two call styles are supported:
 *  - Dictionary key:  t("table.action.addRow")
 *  - Inline entry:    t({ en: "Nodes", ja: "ノード" })
 *
 * The inline form lets each component carry its own translations, so localizing
 * a new component never touches a shared file.
 */
export function useT(): (key: I18nKey | Entry, vars?: TVars) => string {
  const lang = useLang();
  return (key, vars) => {
    const template = typeof key === "string" ? (STRINGS[key][lang] ?? STRINGS[key].en) : (key[lang] ?? key.en);
    return interpolate(template, vars);
  };
}
