# Installing StabilitySoft as an app (PWA)

StabilitySoft is a **Progressive Web App**: it is put on a web address once, then installed on each
computer, tablet or phone from that address. After installing it opens like a normal program and works
**without internet**.

## 1. Put it on a web address (once)

The app is a folder of static files (`dist/` after `npm run build`, or the ready-made zip). Any web
server that serves files over **https** works. Two easy ways:

**A. GitHub Pages (free, automatic)**
1. In GitHub: *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
2. Push to the default branch (or *Actions → Deploy app (GitHub Pages) → Run workflow*).
3. After 2–3 minutes the address is shown in *Settings → Pages*, e.g.
   `https://<account>.github.io/stabiltysoft/`. Every later push updates the app automatically.
   (A private repository needs a paid GitHub plan for Pages; otherwise use option B.)

**B. Any company web server / intranet / cloud storage website**
Copy the contents of the zip (or `dist/`) into a folder of the web server, e.g.
`https://intranet.company.com/stabilitysoft/`. No server program or database is needed. The folder
can be at any depth.

Notes
- Installing needs **https** (or `http://localhost`). Opening `index.html` straight from a disk or USB
  stick runs the app but cannot install it or keep it offline.
- Keep the address the same: the data on each device belongs to that address.

## 2. Install on each device

- **Windows / Mac / Linux (Chrome, Edge):** open the address → click **⬇ Install app** at the top right
  (or the install icon in the address bar). It then appears in the Start menu / Applications.
- **Android (Chrome):** open the address → menu → **Install app**.
- **iPhone / iPad (Safari):** open the address → Share → **Add to Home Screen**.

The first start downloads the app (about 4 MB) for offline use. Text recognition for scanned PDFs
downloads its files (about 11 MB) the first time it is used, then also works offline.

## 3. Where the data is kept

- Each device keeps its own data in the **browser database (IndexedDB)** of the app: your vessels, load
  cases, criteria library and the data record of every import or edit. It is saved on every change.
- The app asks the browser to keep this data **permanently** (shown in *Vessel Database → Storage on
  this device*). Installed apps usually get this.
- Data of older versions (browser localStorage) is moved into the database automatically on the first
  start.
- Data is **not shared** between devices or browsers. Use **Vessel Database → Save database to file**
  to back up and to move data (import it with *Merge* or *Replace* on the other device).
- A reminder appears when there are changes that are not yet in a database file (every 7 days by
  default; change it in *Storage on this device*).

Data is lost if the browser's site data for the address is cleared, or (on some systems) when the
installed app is uninstalled. Keep database files somewhere safe.

## 4. Updates

When a new version is published at the address, the app shows **"A new version is available — Update
now"**. Updating keeps all data. Ships that are offline keep working with their version and update the
next time they are online.
