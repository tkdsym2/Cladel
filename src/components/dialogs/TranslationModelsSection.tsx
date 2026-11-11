import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import VerifiedIcon from "@mui/icons-material/Verified";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import * as cmd from "../../lib/tauri-commands";
import { useT } from "../../lib/i18n";
import { useTranslateStore } from "../../store/translateStore";
import { PlamoLicenseDialog, PLAMO_LICENSE_URL } from "./PlamoLicenseDialog";
import type { LicenseStatus, LocalModels, ModelProgress, RemoteRepo, RemoteModelFile } from "../../types";

const PROGRESS_EVENT = "translation-model-progress";
const SIZE_TITLE: Record<string, string> = { "0.8b": "0.8B", "2b": "2B", "8b": "8B" };

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

const keyOf = (repo: string, filename: string) => `${repo}/${filename}`;
const isTerminal = (s: ModelProgress["status"]) => s === "done" || s === "cancelled" || s === "error";

/**
 * Settings → Translation: PLaMo 3 Translate model manager (catalog from
 * Hugging Face, resumable verified downloads, import, delete, active model)
 * plus license consent and "Built with PLaMo" attribution.
 */
export function TranslationModelsSection() {
  const t = useT();
  const [local, setLocal] = useState<LocalModels | null>(null);
  const [catalog, setCatalog] = useState<RemoteRepo[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [progress, setProgress] = useState<Record<string, ModelProgress>>({});
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshLocal = useCallback(async () => {
    try {
      setLocal(await cmd.translationListLocalModels());
      void useTranslateStore.getState().refreshModelStatus();
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      setCatalog(await cmd.translationRemoteCatalog());
    } catch (e) {
      setError(String(e));
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const refreshLicense = useCallback(async () => {
    try {
      setLicense(await cmd.translationLicenseStatus());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refreshLocal();
    refreshLicense();
    refreshCatalog();
  }, [refreshLocal, refreshLicense, refreshCatalog]);

  useEffect(() => {
    const unlisten = listen<ModelProgress>(PROGRESS_EVENT, (ev) => {
      const p = ev.payload;
      setProgress((prev) => ({ ...prev, [p.key]: p }));
      if (isTerminal(p.status)) {
        refreshLocal();
        if (p.status !== "error") {
          // Clear finished rows shortly after.
          setTimeout(() => setProgress((prev) => {
            const next = { ...prev };
            if (next[p.key] && isTerminal(next[p.key].status)) delete next[p.key];
            return next;
          }), 1500);
        }
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [refreshLocal]);

  /** Run `action` now if the license is accepted, otherwise after consent. */
  const withLicense = (action: () => void) => {
    if (license?.accepted) {
      action();
    } else {
      setPendingAction(() => action);
      setLicenseOpen(true);
    }
  };

  const startDownload = (repo: string, filename: string) =>
    withLicense(() => {
      setError(null);
      cmd.translationDownloadModel(repo, filename).catch((e) => {
        const msg = String(e);
        if (!msg.startsWith("CANCELLED")) setError(msg);
      });
    });

  const startImport = () =>
    withLicense(async () => {
      setError(null);
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "GGUF model", extensions: ["gguf"] }],
      });
      if (typeof selected !== "string") return;
      try {
        await cmd.translationImportModel(selected);
      } catch (e) {
        setError(String(e));
      }
      refreshLocal();
    });

  const handleDelete = async (path: string) => {
    setConfirmDelete(null);
    try {
      await cmd.translationDeleteModel(path);
    } catch (e) {
      setError(String(e));
    }
    refreshLocal();
  };

  const handleActivate = async (path: string) => {
    try {
      await cmd.translationSetActiveModel(path);
    } catch (e) {
      setError(String(e));
    }
    refreshLocal();
  };

  const installedNames = new Set(local?.models.map((m) => m.filename) ?? []);
  const importProgress = Object.values(progress).filter((p) => p.key.startsWith("import:") && !isTerminal(p.status));

  const renderProgress = (p: ModelProgress, onCancel?: () => void) => {
    const pct = p.total > 0 ? Math.min(100, (p.downloaded / p.total) * 100) : 0;
    const label =
      p.status === "hashing"
        ? t({ en: "Checking existing data…", ja: "既存データを確認中…" })
        : p.status === "starting"
          ? t({ en: "Starting…", ja: "開始中…" })
          : p.status === "done"
            ? t({ en: "Done (SHA-256 verified)", ja: "完了（SHA-256 検証済み）" })
            : p.status === "cancelled"
              ? t({ en: "Cancelled — can be resumed", ja: "キャンセル（再開できます）" })
              : p.status === "error"
                ? t({ en: "Failed", ja: "失敗" })
                : `${pct.toFixed(1)}% · ${formatBytes(p.downloaded)} / ${formatBytes(p.total)}${
                    p.bytes_per_sec > 0 ? ` · ${formatBytes(p.bytes_per_sec)}/s` : ""
                  }`;
    return (
      <div style={progressWrapStyle}>
        <div style={barTrackStyle}>
          <div style={{ ...barFillStyle, width: `${pct}%`, background: p.status === "error" ? "#dc2626" : "#2563eb" }} />
        </div>
        <div style={progressRowStyle}>
          <span style={smallMutedStyle}>{label}</span>
          {onCancel && !isTerminal(p.status) && (
            <button onClick={onCancel} style={linkBtnStyle}>
              {t({ en: "Cancel", ja: "キャンセル" })}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderRemoteFile = (f: RemoteModelFile) => {
    const key = keyOf(f.repo, f.filename);
    const p = progress[key];
    const running = p && !isTerminal(p.status);
    const installed = installedNames.has(f.filename);
    const partial = local?.partials.find((x) => x.repo === f.repo && x.filename === f.filename);
    return (
      <div key={key} style={fileRowStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={quantStyle}>{f.quant}</span>
          {f.recommended && <span style={recBadgeStyle}>{t({ en: "Recommended", ja: "推奨" })}</span>}
          <span style={{ ...smallMutedStyle, flex: 1 }}>{formatBytes(f.bytes)}</span>
          {installed ? (
            <span style={installedBadgeStyle}>{t({ en: "Installed", ja: "インストール済み" })}</span>
          ) : running ? null : (
            <button onClick={() => startDownload(f.repo, f.filename)} style={smallBtnStyle}>
              <DownloadIcon sx={{ fontSize: 14 }} />
              {partial ? t({ en: "Resume", ja: "再開" }) : t({ en: "Download", ja: "ダウンロード" })}
            </button>
          )}
        </div>
        {p && renderProgress(p, () => cmd.translationCancelDownload(f.repo, f.filename))}
        {p?.status === "error" && p.error && <div style={errorStyle}>{p.error}</div>}
      </div>
    );
  };

  return (
    <div>
      {/* ── Attribution + license ── */}
      <div style={plamoBoxStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={builtWithStyle}>Built with PLaMo</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => shellOpen(PLAMO_LICENSE_URL.ja)} style={linkBtnStyle}>
            <OpenInNewIcon sx={{ fontSize: 12 }} /> ライセンス
          </button>
          <button onClick={() => shellOpen(PLAMO_LICENSE_URL.en)} style={linkBtnStyle}>
            <OpenInNewIcon sx={{ fontSize: 12 }} /> License
          </button>
        </div>
        <div style={descStyle}>
          {t({
            en: "The Translate node runs PLaMo 3 Translate (Preferred Networks) locally with llama.cpp. Models are not bundled with Filonex; they are downloaded separately and are licensed under the PLaMo Community License. Translation never uses the network.",
            ja: "Translate ノードは PLaMo 3 Translate（Preferred Networks）を llama.cpp でローカル実行します。モデルは Filonex に同梱されておらず別途ダウンロードするもので、PLaMo Community License が適用されます。翻訳中にネットワークは使用しません。",
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <span style={smallMutedStyle}>
            {license?.accepted
              ? t({ en: "License accepted", ja: "ライセンス同意済み" }) +
                (license.accepted_at ? ` (${new Date(license.accepted_at).toLocaleString()})` : "")
              : license?.needs_reaccept
                ? t({ en: "The license text was updated — please review it again.", ja: "ライセンス本文が更新されました。再度ご確認ください。" })
                : t({ en: "License not accepted yet", ja: "ライセンス未同意" })}
          </span>
          <button onClick={() => { setPendingAction(null); setLicenseOpen(true); }} style={linkBtnStyle}>
            {t({ en: "View license", ja: "ライセンスを表示" })}
          </button>
          {license?.accepted && (
            <button onClick={() => cmd.translationRevokeLicense().then(setLicense)} style={linkBtnStyle}>
              {t({ en: "Withdraw consent", ja: "同意を取り消す" })}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ ...errorStyle, margin: "8px 0" }}>
          {error}
          <button onClick={() => setError(null)} style={{ ...linkBtnStyle, marginLeft: 8 }}>×</button>
        </div>
      )}

      {/* ── Installed ── */}
      <div style={headingStyle}>{t({ en: "Installed models", ja: "インストール済みのモデル" })}</div>
      {local && local.models.length === 0 && local.partials.length === 0 && (
        <div style={smallMutedStyle}>{t({ en: "No models installed yet.", ja: "まだモデルがありません。" })}</div>
      )}
      {local?.models.map((m) => (
        <div key={m.path} style={installedRowStyle}>
          <input
            type="radio"
            name="active-translation-model"
            checked={m.active}
            onChange={() => handleActivate(m.path)}
            title={t({ en: "Use for translation", ja: "翻訳に使う" })}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                {m.size_label ? `PLaMo 3 Translate ${SIZE_TITLE[m.size_label]}` : m.filename}
              </span>
              {m.quant && <span style={quantStyle}>{m.quant}</span>}
              {m.verified ? (
                <span style={verifiedStyle} title={m.sha256 ?? ""}>
                  <VerifiedIcon sx={{ fontSize: 12 }} /> {t({ en: "Verified", ja: "検証済み" })}
                </span>
              ) : (
                <span style={unverifiedStyle}>
                  {m.source === "manual" ? t({ en: "Placed manually", ja: "手動配置" }) : t({ en: "Not verified", ja: "未検証" })}
                </span>
              )}
            </div>
            <div style={monoMutedStyle}>{m.filename} · {formatBytes(m.bytes)}</div>
          </div>
          {confirmDelete === m.path ? (
            <>
              <button onClick={() => handleDelete(m.path)} style={dangerBtnStyle}>{t({ en: "Delete", ja: "削除" })}</button>
              <button onClick={() => setConfirmDelete(null)} style={smallBtnStyle}>{t({ en: "Keep", ja: "やめる" })}</button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(m.path)} style={iconBtnStyle} title={t({ en: "Delete", ja: "削除" })}>
              <DeleteOutlineIcon sx={{ fontSize: 16 }} />
            </button>
          )}
        </div>
      ))}

      {local?.partials.map((p) => {
        const live = progress[keyOf(p.repo, p.filename)];
        const running = p.running || (live && !isTerminal(live.status));
        return (
          <div key={p.path} style={installedRowStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                {t({ en: "Interrupted download", ja: "中断したダウンロード" })}
              </div>
              <div style={monoMutedStyle}>
                {p.filename} · {formatBytes(p.downloaded)} / {formatBytes(p.total)} (
                {((p.downloaded / Math.max(1, p.total)) * 100).toFixed(1)}%)
              </div>
            </div>
            {!running && (
              <>
                <button onClick={() => startDownload(p.repo, p.filename)} style={smallBtnStyle}>
                  {t({ en: "Resume", ja: "再開" })}
                </button>
                <button onClick={() => handleDelete(p.path)} style={iconBtnStyle} title={t({ en: "Delete", ja: "削除" })}>
                  <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                </button>
              </>
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <button onClick={startImport} style={smallBtnStyle}>
          <FileUploadIcon sx={{ fontSize: 14 }} />
          {t({ en: "Import a local .gguf…", ja: "手元の .gguf を取り込む…" })}
        </button>
        {local && (
          <button onClick={() => cmd.openFileExternal(local.models_dir)} style={smallBtnStyle}>
            <FolderOpenIcon sx={{ fontSize: 14 }} />
            {t({ en: "Open models folder", ja: "モデルフォルダを開く" })}
          </button>
        )}
      </div>
      {importProgress.map((p) => (
        <div key={p.key} style={{ marginTop: 6 }}>
          <div style={smallMutedStyle}>
            {p.filename}: {p.status === "hashing"
              ? t({ en: "Computing SHA-256…", ja: "SHA-256 を計算中…" })
              : t({ en: "Copying…", ja: "コピー中…" })}
          </div>
        </div>
      ))}

      {/* ── Available ── */}
      <div style={{ ...headingStyle, display: "flex", alignItems: "center" }}>
        <span style={{ flex: 1 }}>{t({ en: "Download from Hugging Face", ja: "Hugging Face からダウンロード" })}</span>
        <button onClick={refreshCatalog} style={iconBtnStyle} disabled={catalogLoading} title={t({ en: "Refresh", ja: "更新" })}>
          <RefreshIcon sx={{ fontSize: 16 }} />
        </button>
      </div>
      {catalogLoading && !catalog && <div style={smallMutedStyle}>{t("common.loading")}</div>}
      {catalog?.map((repo) => (
        <div key={repo.repo} style={repoBoxStyle}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>PLaMo 3 Translate {SIZE_TITLE[repo.size_label]}</span>
            <button onClick={() => shellOpen(`https://huggingface.co/${repo.repo}`)} style={linkBtnStyle}>
              {repo.repo}
            </button>
          </div>
          {repo.error && (
            <div style={smallMutedStyle}>
              {repo.from_cache
                ? t({ en: "Offline — showing the last known list.", ja: "オフラインのため、前回取得した一覧を表示しています。" })
                : t({ en: "Could not load the file list (offline?).", ja: "ファイル一覧を取得できませんでした（オフライン？）。" })}
            </div>
          )}
          {repo.files.map(renderRemoteFile)}
        </div>
      ))}

      <PlamoLicenseDialog
        open={licenseOpen}
        onClose={() => {
          setLicenseOpen(false);
          setPendingAction(null);
        }}
        onAccepted={async () => {
          setLicenseOpen(false);
          await refreshLicense();
          const action = pendingAction;
          setPendingAction(null);
          action?.();
        }}
      />
    </div>
  );
}

// ─── Styles ───

const plamoBoxStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 12,
  background: "#f9fafb",
  marginBottom: 12,
};
const builtWithStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#ea580c",
  border: "1px solid #fdba74",
  background: "#fff7ed",
  borderRadius: 4,
  padding: "2px 8px",
};
const descStyle: React.CSSProperties = { fontSize: 12, color: "#4b5563", lineHeight: 1.5, marginTop: 8 };
const headingStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#9ca3af",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  margin: "16px 0 8px",
};
const installedRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  marginBottom: 6,
};
const repoBoxStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "8px 10px",
  marginBottom: 8,
};
const fileRowStyle: React.CSSProperties = { padding: "5px 0", borderTop: "1px solid #f3f4f6" };
const quantStyle: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 11.5,
  background: "#f3f4f6",
  borderRadius: 4,
  padding: "1px 6px",
  color: "#374151",
};
const recBadgeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "#ea580c",
  background: "#ffedd5",
  borderRadius: 4,
  padding: "1px 6px",
};
const installedBadgeStyle: React.CSSProperties = { fontSize: 11, color: "#059669", fontWeight: 600 };
const verifiedStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  fontSize: 10.5,
  color: "#059669",
};
const unverifiedStyle: React.CSSProperties = { fontSize: 10.5, color: "#b45309" };
const smallMutedStyle: React.CSSProperties = { fontSize: 11.5, color: "#6b7280" };
const monoMutedStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#9ca3af",
  fontFamily: "monospace",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const errorStyle: React.CSSProperties = { fontSize: 11.5, color: "#dc2626", wordBreak: "break-word" };
const smallBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 10px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#374151",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const dangerBtnStyle: React.CSSProperties = { ...smallBtnStyle, border: "1px solid #dc2626", background: "#dc2626", color: "#fff" };
const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  background: "none",
  border: "none",
  color: "#6b7280",
  cursor: "pointer",
  padding: 4,
};
const linkBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  background: "none",
  border: "none",
  padding: 0,
  color: "#2563eb",
  fontSize: 11.5,
  cursor: "pointer",
};
const progressWrapStyle: React.CSSProperties = { marginTop: 4 };
const barTrackStyle: React.CSSProperties = { height: 5, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" };
const barFillStyle: React.CSSProperties = { height: "100%", transition: "width 0.2s" };
const progressRowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", marginTop: 2 };
