"use client";

import { useEffect, useRef } from "react";
import { t } from "@/i18n/t";
import { readShortcutsOff, useUiStore } from "@/hooks/useUiStore";

/** Global single-key shortcuts (ui-guideline.md section 8) and their reference dialog. */
export function ShortcutsDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const { shortcutsOff, setShortcutsOff, requestToggleAll } = useUiStore();

  // Load the saved preference once mounted, so server and first client render agree.
  useEffect(() => {
    useUiStore.setState({ shortcutsOff: readShortcutsOff() });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]")) return;
      if (ref.current?.open) return;
      if (e.key === "?") {
        e.preventDefault();
        ref.current?.showModal();
        return;
      }
      if (shortcutsOff) return;
      if ((e.key === "e" || e.key === "E") && document.querySelector("[data-remarks-toggle]")) {
        e.preventDefault();
        requestToggleAll();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcutsOff, requestToggleAll]);

  return (
    <>
      <button type="button" className="btn-text" aria-keyshortcuts="Shift+/" onClick={() => ref.current?.showModal()}>
        {t("nav.shortcuts")}
      </button>
      <dialog ref={ref} aria-labelledby="sd-title">
        <div className="dialog-head">
          <h2 id="sd-title" className="panel-title" style={{ margin: 0 }}>{t("shortcuts.title")}</h2>
          <button type="button" className="btn" onClick={() => ref.current?.close()}>{t("shortcuts.close")}</button>
        </div>
        <div className="dialog-body">
          <table className="shortcuts">
            <tbody>
              <tr><td><kbd>E</kbd></td><td>{t("shortcuts.e")}</td></tr>
              <tr><td><kbd>J</kbd> <kbd>K</kbd></td><td>{t("shortcuts.jk")}</td></tr>
              <tr><td><kbd>?</kbd></td><td>{t("shortcuts.help")}</td></tr>
              <tr><td><kbd>Esc</kbd></td><td>{t("shortcuts.esc")}</td></tr>
            </tbody>
          </table>
          <label className="switch">
            <input type="checkbox" checked={shortcutsOff} onChange={(e) => setShortcutsOff(e.target.checked)} /> {t("shortcuts.off")}
          </label>
        </div>
      </dialog>
    </>
  );
}
