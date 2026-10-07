"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { CircleCheck, CircleHelp, CircleAlert, Info, LoaderCircle } from "lucide-react";

type Tone = "success" | "error" | "warning" | "info";
type Alert = { id: number; message: string; tone: Tone; title?: string; confirm?: boolean; resolve?: (accepted: boolean) => void };
type Alerts = { show: (message: string, tone?: Tone) => void; confirm: (message: string) => Promise<boolean> };
const AlertContext = createContext<Alerts | null>(null);

export function Spinner() { return <LoaderCircle className="button-spinner" size={18} aria-hidden="true"/>; }

export function CenteredAlert({ message, tone = "error", title, confirm = false, onClose }: { message: string; tone?: Tone; title?: string; confirm?: boolean; onClose: (accepted: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const Icon = confirm ? CircleHelp : tone === "success" ? CircleCheck : tone === "info" ? Info : CircleAlert;
  useEffect(() => {
    const element = dialog.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); if (previouslyFocused?.isConnected) previouslyFocused.focus(); };
  }, []);
  return <dialog ref={dialog} className={`centered-alert alert-${confirm ? "warning" : tone}`} role="alertdialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-message`} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(false); }} onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}>
    <div className="alert-symbol"><Icon size={48} strokeWidth={1.7}/></div>
    <h2 id={`${id}-title`}>{title || (confirm ? "Please confirm" : tone === "success" ? "Success!" : tone === "error" ? "Something went wrong" : tone === "warning" ? "Please note" : "Workspace update")}</h2>
    <p id={`${id}-message`}>{message}</p>
    <div className="alert-actions">{confirm && <button type="button" className="button button-secondary" autoFocus onClick={() => onClose(false)}>Cancel</button>}<button type="button" className="button button-primary" autoFocus={!confirm} onClick={() => onClose(true)}>{confirm ? "Yes, continue" : "OK, got it"}</button></div>
  </dialog>;
}

export function ErrorAlert({ message, onClose }: { message: string; onClose: () => void }) {
  return message ? <CenteredAlert message={message} onClose={onClose}/> : null;
}

export function DismissibleErrorAlert({ message }: { message: string }) {
  const [dismissed, setDismissed] = useState("");
  return message && dismissed !== message ? <CenteredAlert message={message} onClose={() => setDismissed(message)}/> : null;
}

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<Alert[]>([]);
  const sequence = useRef(0);
  const show = useCallback((message: string, tone: Tone = "success") => {
    const id = ++sequence.current;
    setQueue((items) => [...items, { id, message, tone }]);
  }, []);
  const confirm = useCallback((message: string) => new Promise<boolean>((resolve) => {
    const id = ++sequence.current;
    setQueue((items) => [...items, { id, message, tone: "warning", confirm: true, resolve }]);
  }), []);
  const active = queue[0];
  function close(accepted: boolean) {
    active?.resolve?.(accepted);
    setQueue((items) => items.slice(1));
  }
  return <AlertContext.Provider value={{ show, confirm }}>{children}{active && <CenteredAlert key={active.id} {...active} onClose={close}/>}</AlertContext.Provider>;
}

export function useAlerts() {
  const context = useContext(AlertContext);
  if (!context) throw new Error("Alerts require AlertProvider.");
  return context;
}
