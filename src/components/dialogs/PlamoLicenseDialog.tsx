import { useEffect, useState } from "react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import * as cmd from "../../lib/tauri-commands";
import { useLang, useT } from "../../lib/i18n";
import type { LicenseText } from "../../types";

export const PLAMO_LICENSE_URL = {
  ja: "https://plamo.preferredai.jp/info/plamo-community-license-ja",
  en: "https://plamo.preferredai.jp/info/plamo-community-license-en",
} as const;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after consent was recorded. */
  onAccepted: () => void;
}

/**
 * Shows the full PLaMo Community License (official text from the model
 * repository, cached for offline use) and records consent. Downloading or
 * importing a model is blocked until the user accepts.
 */
export function PlamoLicenseDialog({ open, onClose, onAccepted }: Props) {
  const t = useT();
  const uiLang = useLang();
  const [lang, setLang] = useState<"ja" | "en">(uiLang === "ja" ? "ja" : "en");
  const [license, setLicense] = useState<LicenseText | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLicense(null);
    setChecked(false);
    setError(null);
    cmd
      .translationGetLicense(lang)
      .then((l) => !cancelled && setLicense(l))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, lang]);

  if (!open) return null;

  const hasText = !!license?.text;
  const handleAccept = async () => {
    setSaving(true);
    setError(null);
    try {
      await cmd.translationAcceptLicense(lang, license?.sha256 ?? null);
      onAccepted();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <span style={titleStyle}>PLaMo Community License</span>
          <div style={{ display: "flex", gap: 4 }}>
            {(["ja", "en"] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)} style={l === lang ? langActiveStyle : langStyle}>
                {l === "ja" ? "日本語" : "English"}
              </button>
            ))}
          </div>
          <button onClick={onClose} style={closeStyle} aria-label="Close">
            <CloseIcon sx={{ fontSize: 18 }} />
          </button>
        </div>

        <p style={leadStyle}>
          {t({
            en: "PLaMo 3 Translate models are provided by Preferred Networks under the PLaMo Community License, separately from Filonex. Please read the full license before downloading or importing a model.",
            ja: "PLaMo 3 Translate のモデルは、Filonex とは別に Preferred Networks が PLaMo Community License のもとで提供しています。モデルをダウンロード・取り込む前に、ライセンス全文をお読みください。",
          })}
        </p>

        <div style={textBoxStyle}>
          {loading ? (
            <div style={mutedStyle}>{t("common.loading")}</div>
          ) : hasText ? (
            <pre style={preStyle}>{license!.text}</pre>
          ) : (
            <div style={mutedStyle}>
              {t({
                en: "The license text could not be loaded (offline?). Please read it on the official page:",
                ja: "ライセンス全文を取得できませんでした（オフライン？）。公式ページで全文をご確認ください：",
              })}
            </div>
          )}
        </div>

        {license?.from_cache && (
          <div style={noteStyle}>
            {t({ en: "Showing the copy saved on this computer.", ja: "このコンピュータに保存されたコピーを表示しています。" })}
          </div>
        )}

        <button onClick={() => shellOpen(PLAMO_LICENSE_URL[lang])} style={linkStyle}>
          <OpenInNewIcon sx={{ fontSize: 13 }} />
          {PLAMO_LICENSE_URL[lang]}
        </button>

        <label style={checkRowStyle}>
          <input
            type="checkbox"
            checked={checked}
            disabled={loading}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>
            {hasText
              ? t({ en: "I have read and agree to the PLaMo Community License.", ja: "PLaMo Community License を読み、同意します。" })
              : t({
                  en: "I have read the full license on the official page and agree to it.",
                  ja: "公式ページでライセンス全文を読み、同意します。",
                })}
          </span>
        </label>

        {error && <div style={errorStyle}>{error}</div>}

        <div style={footerStyle}>
          <button onClick={onClose} style={secondaryBtnStyle}>
            {t({ en: "Cancel", ja: "キャンセル" })}
          </button>
          <button
            onClick={handleAccept}
            disabled={!checked || saving || loading}
            style={{ ...primaryBtnStyle, opacity: !checked || saving || loading ? 0.5 : 1 }}
          >
            {t({ en: "Agree and continue", ja: "同意して続ける" })}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 10001,
};

const dialogStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 20,
  width: 640,
  maxWidth: "92vw",
  // Fixed height: switching language / loading must not resize the modal.
  height: "min(720px, 88vh)",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
};

const headerStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10 };
const titleStyle: React.CSSProperties = { fontSize: 16, fontWeight: 700, color: "#111827", flex: 1 };
const closeStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#6b7280",
  display: "flex",
  padding: 4,
};
const langStyle: React.CSSProperties = {
  padding: "3px 10px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#374151",
  cursor: "pointer",
};
const langActiveStyle: React.CSSProperties = { ...langStyle, border: "1px solid #2563eb", background: "#2563eb", color: "#fff" };
const leadStyle: React.CSSProperties = { fontSize: 12.5, color: "#4b5563", margin: 0, lineHeight: 1.5 };
const textBoxStyle: React.CSSProperties = {
  // Takes all remaining height; the text scrolls inside it.
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  background: "#f9fafb",
  padding: 12,
};
const preStyle: React.CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 12,
  lineHeight: 1.6,
  fontFamily: "inherit",
  color: "#1f2937",
};
const mutedStyle: React.CSSProperties = { fontSize: 12.5, color: "#6b7280" };
const noteStyle: React.CSSProperties = { fontSize: 11, color: "#9ca3af" };
const linkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  alignSelf: "flex-start",
  background: "none",
  border: "none",
  padding: 0,
  color: "#2563eb",
  fontSize: 12,
  cursor: "pointer",
  textDecoration: "underline",
};
const checkRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  color: "#111827",
  cursor: "pointer",
};
const errorStyle: React.CSSProperties = { fontSize: 12, color: "#dc2626" };
const footerStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8 };
const secondaryBtnStyle: React.CSSProperties = {
  padding: "7px 16px",
  fontSize: 13,
  borderRadius: 6,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#374151",
  cursor: "pointer",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "7px 16px",
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 6,
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};
