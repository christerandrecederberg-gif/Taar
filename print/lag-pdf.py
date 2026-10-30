"""Lager Taar-sjekkliste.pdf (A4 liggende, én side per liste) fra sjekkliste.md."""
import html, pathlib, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
SRC, HTML, PDF = HERE / "sjekkliste.md", HERE / "sjekkliste-print.html", HERE / "Taar-sjekkliste.pdf"
COLUMNS = ["Date"] * 7
LEGEND = "✓ = completed &nbsp;|&nbsp; N/A = not applicable &nbsp;|&nbsp; If not completed, write a short reason directly in that day's cell"
PAGE_MM = 189  # usable height on A4 landscape with the margins below
HEADER_MM = 41  # title block, table header, initials row and footer
# Tår brand profile (see print/brand/README.md)
BLUE, TAUPE, INK = "#2C428B", "#8A8070", "#1B1F2B"
LOGO = "brand/logo-cocktails-kaffe-crop.png"


def parse(text):
    pages = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("## "):
            pages.append({"title": line[3:], "sub": "", "initials": "Initials", "rows": []})
        elif not pages:
            continue
        elif line.startswith("Undertittel:"):
            pages[-1]["sub"] = line.split(":", 1)[1].strip()
        elif line.startswith("Initialer:"):
            pages[-1]["initials"] = line.split(":", 1)[1].strip()
        elif line.startswith("### "):
            pages[-1]["rows"].append(("section", line[4:]))
        elif line.startswith("- "):
            pages[-1]["rows"].append(("item", line[2:]))
    return pages


def render(pages):
    n = 0
    body = []
    for p in pages:
        items = sum(1 for k, _ in p["rows"] if k == "item")
        sections = len(p["rows"]) - items
        # Give the writing rows as much height as the page allows, between 4.6 and 8 mm.
        row_mm = max(4.6, min(8.0, (PAGE_MM - HEADER_MM - sections * 5.2) / max(items, 1)))
        rows, zebra = [], 0
        for kind, text in p["rows"]:
            if kind == "section":
                zebra = 0
                rows.append(f'<tr class="sec"><td colspan="{2 + len(COLUMNS)}">{html.escape(text.upper())}</td></tr>')
                continue
            n += 1
            cls = ' class="z"' if zebra % 2 else ""
            zebra += 1
            rows.append(f'<tr{cls} style="height:{row_mm:.2f}mm"><td class="n">{n}</td><td class="t">{html.escape(text)}</td>' + "<td></td>" * len(COLUMNS) + "</tr>")
        head = "".join(f"<th>{c}</th>" for c in COLUMNS)
        body.append(f"""<section class="page"><header><div><h1>{html.escape(p['title'])}</h1>
<p class="sub">{html.escape(p['sub'])}</p><p class="leg">{LEGEND}</p></div><img class="logo" src="{LOGO}" alt="Tår"></header>
<table><thead><tr><th class="n">#</th><th class="t">Task</th>{head}</tr></thead>
<tbody><tr class="ini"><td colspan="2">{html.escape(p['initials'])}</td>{'<td></td>' * len(COLUMNS)}</tr>{''.join(rows)}</tbody></table>
<div class="foot"><span>TÅR /tɔːr/ — a sip</span><span>KRISTIANSAND</span></div></section>""")
    css = (HERE / "brand/fonts/fonts.css").read_text() + f"""
@page{{size:A4 landscape;margin:10mm 11mm}}
*{{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
body{{font-family:Inter,Arial,sans-serif;color:{INK};margin:0}}
.page{{break-after:page;position:relative;height:189mm}}.page:last-child{{break-after:auto}}
header{{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:2.5mm}}
h1{{font-family:Inter,Arial,sans-serif;font-weight:700;font-size:13pt;letter-spacing:.09em;text-transform:uppercase;color:{BLUE};margin:0 0 1mm}}
.sub{{font-family:Spectral,Georgia,serif;font-style:italic;font-weight:400;font-size:11pt;margin:0}}
.leg{{font-size:7pt;color:{TAUPE};margin:1mm 0 0}}
.logo{{height:16mm;width:auto}}
table{{width:100%;border-collapse:collapse;table-layout:fixed;font-size:7.6pt}}
th,td{{border:.5pt solid #c4c7cf;padding:0 3pt;vertical-align:middle}}
th{{background:{BLUE};color:#fff;font-size:6.5pt;font-weight:600;letter-spacing:.08em;text-transform:uppercase;height:5.5mm;border-color:{BLUE}}}
th.n,td.n{{width:7mm;text-align:center}}th.t,td.t{{width:142mm;text-align:left}}
td.n{{color:{BLUE};font-weight:600;font-size:7.5pt}}
tr.z td{{background:#e9e9e9}}
tr.sec td{{background:#dde2ee;color:{BLUE};font-weight:700;font-size:6.5pt;letter-spacing:.1em;height:5.2mm}}
tr.ini td{{background:#f7f4ef;font-weight:600;font-size:7pt;height:8mm}}
.foot{{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-between;font-size:7pt;color:{TAUPE}}}
.foot span:first-child{{font-family:Spectral,Georgia,serif;font-style:italic;font-size:8.5pt}}
.foot span:last-child{{letter-spacing:.3em;font-size:6pt}}"""
    return f'<!doctype html><meta charset="utf-8"><title>Tår sjekkliste</title><style>{css}</style>{"".join(body)}'


def main():
    HTML.write_text(render(parse(SRC.read_text(encoding="utf-8"))), encoding="utf-8")
    pw = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip() + "/playwright/index.mjs"
    js = f"""import {{ chromium }} from '{pw}';
const b = await chromium.launch(); const p = await b.newPage();
await p.goto('file://{HTML}'); await p.pdf({{ path: '{PDF}', preferCSSPageSize: true, printBackground: true }}); await b.close();"""
    subprocess.run(["node", "--input-type=module", "-e", js], check=True)
    print(f"Lagret {PDF}")


if __name__ == "__main__":
    sys.exit(main())
