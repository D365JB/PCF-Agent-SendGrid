# PCF Deployment Runbook (Team)

This guide documents the fastest, repeatable way to build and deploy this control.

## Scope

- Control deployed in this workflow: `PCFCopilot.CopilotReactControl`
- Project used for push: `PCFInitTest/PCFReactTest`
- Target Dataverse example used here: `JMBDemo2`

---

## 1) One-time machine setup

1. Install Node.js LTS.
2. Install Power Platform CLI (`pac`) and sign in.
3. Restore dependencies at least once:

```powershell
cd "C:\Users\jamesbowen\OneDrive - Microsoft\VS Code Projects\PCFCopilot"
npm install
cd .\PCFInitTest\PCFReactTest
npm install
```

4. Confirm auth profiles are available:

```powershell
pac auth list
```

---

## 2) Best order of operations (every deployment)

### Step A: Open the correct project folder context

Use the React PCF project for deployment to avoid multi-manifest discovery conflicts.

```powershell
cd "C:\Users\jamesbowen\OneDrive - Microsoft\VS Code Projects\PCFCopilot\PCFInitTest\PCFReactTest"
```

### Step B: Select target environment before push

```powershell
pac auth list
pac auth select --index <INDEX_OF_TARGET_ENV>
pac auth list
```

Verify the `*` active profile is your intended environment (for example, `JMBDemo2`).

### Step C: Build locally first

```powershell
npm run build
```

If local build fails, do not push yet.

### Step D: Push

```powershell
pac pcf push
```

### Step E: Validate in Dataverse app

1. Open app where control is used.
2. Hard refresh browser.
3. Confirm control loads and renders expected UI.
4. Run a quick functional test (send message, verify response/UI updates).

---

## 3) Fast-path command block (copy/paste)

```powershell
cd "C:\Users\jamesbowen\OneDrive - Microsoft\VS Code Projects\PCFCopilot\PCFInitTest\PCFReactTest"
pac auth list
pac auth select --index <TARGET_INDEX>
npm run build
pac pcf push
```

---

## 4) Known gotchas and fixes

### A) Error: more than one `ControlManifest.Input.xml`

**Symptom**
- `Found more than one project source file named 'ControlManifest.Input.xml'`

**Cause**
- Running `pac pcf push` from a folder containing nested PCF projects.

**Fix**
- Run push from `PCFInitTest/PCFReactTest` (single control project).

### B) Error: platform library Fluent version not supported

**Symptom**
- Import fails with Fluent version unsupported.

**Fix used in this repo**
- Set Fluent platform library to `9.4.0` in:
  - `PCFInitTest/PCFReactTest/CopilotReactControl/ControlManifest.Input.xml`

### C) Error: another solution import is running

**Symptom**
- `Cannot start another [Import] because there is a previous [Import] running`

**Fix**
1. Wait 30-60 seconds.
2. Retry `pac pcf push`.
3. If repeated, check Solution History in environment and retry after active import completes.

### D) Manifest validation additional property `$`

**Symptom**
- `instance.manifest is not allowed to have the additional property "$"`

**Fix**
- Ensure manifest is a single valid XML document (no duplicate/trailing XML declaration).
- Ensure root `<manifest>` matches PCF template structure.

---

## 5) Team checklist (release-ready)

1. Pull latest main branch.
2. Confirm target environment selected (`pac auth list`).
3. Build succeeds locally (`npm run build`).
4. Push succeeds (`pac pcf push`).
5. Validate behavior in app.
6. Share deployment note in team channel:
   - Commit/branch
   - Environment
   - Control name
   - Result (success/fail)
   - Any workaround used

---

## 6) Recommended team standard

- Always deploy from `PCFInitTest/PCFReactTest`.
- Always run `npm run build` before `pac pcf push`.
- Always switch environment explicitly before push.
- If import is locked, wait and retry instead of changing project files.
