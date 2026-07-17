// Copiar texto al portapapeles de forma robusta: primero la Clipboard API y, si
// está restringida, respaldo con execCommand sobre un <textarea> enfocado (sirve
// dentro del gesto del usuario incluso donde la Clipboard API no). Devuelve si
// quedó copiado. El portapapeles NO lo gobierna el CSP `frame-src`, así que es la
// vía fiable para sacar el JSON de la app en Safari (que no descarga archivos
// desde el iframe de App Engine).
export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* cae al respaldo execCommand */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    // execCommand está deprecado pero sigue siendo el respaldo más compatible para
    // copiar cuando la Clipboard API está restringida (p. ej. Safari en el iframe).
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
};
