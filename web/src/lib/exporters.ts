export function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  trigger(URL.createObjectURL(blob), filename);
}

export async function downloadPNG(node: HTMLElement, filename: string) {
  const { toPng } = await import("html-to-image");
  const bg = getComputedStyle(document.body).backgroundColor;
  const url = await toPng(node, { backgroundColor: bg, pixelRatio: 2, filter: (n) => !(n as HTMLElement).dataset?.noexport });
  trigger(url, filename);
}

function trigger(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
