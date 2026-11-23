import { useEffect, useRef, useState } from "react";
import "../styles/localHost.css";
import { hostText } from "../i18nHost.js";

export function LocalProjectNameDialog({ language, onClose, onSave }) {
  const dialog = useRef(null);
  const [name, setName] = useState(() => hostText(language, "defaultName"));
  const ht = key => hostText(language, key);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="local-project-name-dialog" aria-labelledby="local-project-name-title"
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()}>
    <form onSubmit={event => { event.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
      <h2 id="local-project-name-title">{ht("save")}</h2>
      <label htmlFor="local-project-name">{ht("name")}</label>
      <input id="local-project-name" autoFocus required maxLength={150} value={name} onChange={event => setName(event.target.value)} />
      <div><button type="button" onClick={onClose}>{ht("close")}</button><button type="submit" disabled={!name.trim()}>{ht("save")}</button></div>
    </form>
  </dialog>;
}
