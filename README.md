# KNF Studio

## Fresh Windows Setup

1. Open **PowerShell** or **Windows Terminal** and install Python + Node.js:

```powershell
winget install Python.Python.3.11
winget install OpenJS.NodeJS.LTS
```

2. Open the project folder in **File Explorer**.

3. In that folder, open **Command Prompt** or **PowerShell** and run:

```bat
install.bat
```

4. Start the app in the same folder:

```sh
npm run dev
```

If `xtb` or `obabel` are missing, install them in **PowerShell**:

```powershell
winget install --id OpenBabel.OpenBabel -e
winget install --id GrimmeLab.xTB -e
```

Or with conda:

```powershell
conda install -c conda-forge xtb openbabel
```

If Python is not on `PATH`, the app tries `py -3` first.

## Run The App

Open **Command Prompt** or **PowerShell** in the project folder and run:

```sh
npm run dev
```

This starts the frontend, Electron, and the local backend.

To run only the backend:

```sh
npm run dev:backend
```

## Troubleshooting

- If `npm run dev` fails, make sure `install.bat` finished successfully.
- If the backend does not start, check that Python is installed.
- If calculations fail, install `xtb` and `obabel`.
- If port `8765` is busy, close the other app using it and try again.

## Tech Stack

- Vite
- TypeScript
- React
- Electron
- shadcn/ui
- Tailwind CSS
