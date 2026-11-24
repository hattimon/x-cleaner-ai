import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpRight, Check, ClipboardPaste, Copy } from 'lucide-react';
import { xClientIdPattern } from '../shared/contracts.js';
import type { Integrations } from '../shared/contracts.js';
import type { Run } from './account-views.js';
import { api } from './api.js';
import { phrase, tr } from './i18n.js';
import { Button, Dialog, ErrorBanner } from './ui.js';

const appName = 'X-Cleaner AI';
const website = 'https://github.com/hattimon/x-cleaner-ai';
const appDescription = 'Self-hosted dashboard for reviewing the accounts you follow on X and confirming individual follow or unfollow actions.';
const useCase = 'X-Cleaner AI is a self-hosted tool with publicly available source code for reviewing the accounts a user follows on X. Users authorize their own accounts through OAuth. The app reads the authorized identity, following list, profile information and available posts to summarize activity and flag potential spam for review. Users can run or schedule read-only scans, import their own X archive and export review results. Each follow or unfollow requires individual confirmation. Users can opt to send derived metrics, evidence categories, post references and their assistant questions to a selected AI provider for analysis. The app stores its data on the user’s server and encrypts OAuth tokens.';
const lastStep = 3;

export const xIdentityCost = () => phrase('Po autoryzacji X może naliczyć koszt jednego odczytu profilu.', 'X may charge for one profile lookup after you approve access.');

function ConsoleLink() {
  return <a className="button button--secondary" href="https://console.x.com/" target="_blank" rel="noreferrer"><ArrowUpRight size={16} />
    {phrase('Otwórz konsolę X', 'Open X Developer Console')}
  </a>;
}

function CopyValue({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const id = useId();
  const field = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [feedback, setFeedback] = useState<'copied' | 'selected'>();
  const copy = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(value);
        setFeedback('copied');
        return;
      }
    } catch { /* Selecting the field also works when clipboard access is unavailable. */ }
    field.current?.focus();
    field.current?.select();
    setFeedback('selected');
  };
  const inputProps = {
    id, value, readOnly: true, spellCheck: false, lang: multiline ? 'en' : undefined,
    ref: (node: HTMLInputElement | HTMLTextAreaElement | null) => { field.current = node; },
  };
  return <div className="setup-copy">
    <label htmlFor={id}>{label}</label>
    {multiline ? <textarea {...inputProps} rows={4} /> : <input {...inputProps} />}
    <div className="row-actions">
      <Button tone="quiet" icon={<Copy size={15} />} aria-label={phrase('Kopiuj ', 'Copy ') + label} onClick={() => void copy()}>{phrase('Kopiuj', 'Copy')}</Button>
      {feedback && <small className="muted" role="status">{feedback === 'copied' ? phrase('Skopiowano.', 'Copied.')
        : phrase('Zaznaczono tekst. Naciśnij Ctrl+C lub wybierz Kopiuj.', 'Text selected. Press Ctrl+C or choose Copy.')}</small>}
    </div>
  </div>;
}

export function XConnectionWizard({ x, run, close }: { x: Integrations['x']; run: Run; close: () => void }) {
  const [step, setStep] = useState(x.configured ? lastStep : 0);
  const [clientId, setClientId] = useState(x.clientId);
  const [clientSecret, setClientSecret] = useState('');
  const [writeEnabled, setWriteEnabled] = useState(x.writeEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [pasteHelp, setPasteHelp] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const idField = useRef<HTMLInputElement>(null);
  const steps = [
    phrase('Konto deweloperskie', 'Developer account'),
    phrase('Nowa aplikacja', 'New app'),
    phrase('Ustawienia OAuth', 'OAuth settings'),
    phrase('Połączenie konta', 'Connect account'),
  ];
  const trimmedClientId = clientId.trim();
  const validClientId = xClientIdPattern.test(trimmedClientId);

  useEffect(() => { heading.current?.focus(); }, [step]);

  const pasteId = async () => {
    try {
      const value = (await navigator.clipboard?.readText())?.trim();
      if (value) {
        setClientId(value);
        setPasteHelp(false);
        return;
      }
    } catch { /* The same field accepts ordinary browser paste. */ }
    idField.current?.focus();
    setPasteHelp(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step !== lastStep || !validClientId || busy) return;
    const connect = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') !== 'save';
    setError(undefined);
    setBusy(true);
    const result = await run(async () => {
      try {
        await api.saveXClient({ clientId: trimmedClientId, clientSecret: clientSecret.trim() || undefined, writeEnabled });
        return connect ? await api.startX() : { url: null };
      } catch (failure) {
        setError(failure);
        return null;
      }
    });
    if (result?.url) location.assign(result.url);
    else if (result) close();
    else setBusy(false);
  };

  return <Dialog title={phrase('Połącz konto X', 'Connect X account')} onClose={close}>
    <form className="form-stack" onSubmit={submit}>
      <ol className="setup-progress" aria-label={phrase('Etapy konfiguracji X', 'X setup steps')}>
        {steps.map((name, index) => <li key={index} aria-current={index === step ? 'step' : undefined} className={index < step ? 'complete' : undefined}>
          <span aria-hidden="true">{index < step ? <Check size={14} /> : index + 1}</span>
          {name}
        </li>)}
      </ol>
      <section className="stack" aria-labelledby="x-setup-step">
        <h3 id="x-setup-step" ref={heading} tabIndex={-1}>{steps[step]}</h3>
        {step === 0 && <>
          <p>{phrase('Otwórz konsolę X i zaloguj się swoim kontem. Jeśli pojawi się formularz Developer Program, uzupełnij pola poniżej.', 'Open the X console and sign in. If the Developer Program form appears, fill in the fields below.')}</p>
          <div className="row-actions"><ConsoleLink /></div>
          <p>{phrase('W polu Account Name wpisz swoją nazwę albo nazwę projektu, np. X-Cleaner AI.', 'In Account Name, enter your name or project name, such as X-Cleaner AI.')}</p>
          <CopyValue label="Describe all of your use cases of X’s data and API" value={useCase} multiline />
          <p>{phrase('Wklej opis użycia danych. Przeczytaj warunki programu, zaakceptuj je, jeśli się zgadzasz, i kliknij Submit. Gdy widzisz już konsolę, przejdź dalej.', 'Paste the use-case description. Read and accept the program terms if you agree, then click Submit. Continue when the console opens.')}</p>
        </>}
        {step === 1 && <>
          <p>{phrase('Na pulpicie konsoli X kliknij New App. Wpisz nazwę aplikacji. Jeśli konsola poprosi o unikalną nazwę, dopisz swoje inicjały.', 'From the X console dashboard, click New App. Enter the app name. Add your initials if the console asks for a unique name.')}</p>
          <CopyValue label="App name" value={appName} />
          <details className="integration-details">
            <summary>{phrase('Pola Description i Use case', 'Description and Use case fields')}</summary>
            <div className="stack"><CopyValue label="Description" value={appDescription} multiline /><CopyValue label="Use case" value={useCase} multiline /></div>
          </details>
          <p>{phrase('Po utworzeniu aplikacji otwórz jej stronę w konsoli. Wyszukaj User authentication settings i kliknij Set up. Wróć tutaj po wartości do wklejenia.', 'After creating the app, open it in the console. Find User authentication settings and click Set up. Return here for the values to paste.')}</p>
          <div className="row-actions"><ConsoleLink /></div>
        </>}
        {step === 2 && <>
          <p>{phrase('Uzupełnij ustawienia User authentication settings w konsoli X według poniższych pól.', 'Fill in User authentication settings in the X console using the fields below.')}</p>
          <label className="check"><input type="checkbox" checked={writeEnabled} onChange={event => setWriteEnabled(event.target.checked)} />
            {phrase('Chcę też móc odobserwować konto po pojedynczym potwierdzeniu.', 'I also want to unfollow accounts after individual confirmation.')}
          </label>
          <dl className="setup-choices">
            <div><dt>App permissions</dt><dd>{writeEnabled ? 'Read and write' : 'Read'}</dd></div>
            <div><dt>Type of App</dt><dd>Native App</dd></div>
          </dl>
          <CopyValue label="Callback URI / Redirect URL" value={x.callback} />
          <small className="muted">{phrase('Wklej cały adres razem z portem i końcówką /callback.', 'Paste the entire address, including the port and /callback ending.')}</small>
          <CopyValue label="Website URL" value={website} />
          <p>{phrase('Kliknij Save w konsoli. X pokaże Client ID. Możesz wrócić do niego w zakładce Keys and tokens.', 'Click Save in the console. X displays the Client ID. You can find it again under Keys and tokens.')}</p>
        </>}
        {step === lastStep && <>
          <p>{phrase('W aplikacji w konsoli X otwórz Keys and tokens. W sekcji OAuth 2.0 skopiuj wartość Client ID i wklej ją tutaj.', 'Open Keys and tokens for your app in the X console. In the OAuth 2.0 section, copy the Client ID and paste it here.')}</p>
          <div className="row-actions"><ConsoleLink /></div>
          <label>Client ID<input ref={idField} value={clientId} onChange={event => setClientId(event.target.value)}
            autoComplete="off" spellCheck={false} maxLength={250} aria-invalid={Boolean(trimmedClientId) && !validClientId} required /></label>
          <div className="row-actions">
            <Button tone="quiet" icon={<ClipboardPaste size={16} />} onClick={() => void pasteId()}>{phrase('Wklej Client ID', 'Paste Client ID')}</Button>
            {pasteHelp && <small className="muted" role="status">{phrase('Skopiuj Client ID z konsoli, kliknij pole i naciśnij Ctrl+V.', 'Copy the Client ID in the console, select the field and press Ctrl+V.')}</small>}
          </div>
          {trimmedClientId && !validClientId && <small role="alert">{phrase('Skopiuj Client ID z sekcji OAuth 2.0 keys w konsoli X. Sam numer aplikacji lub konta nie zadziała.', 'Copy the Client ID from OAuth 2.0 keys in the X console. A numeric app or account ID will not work.')}</small>}
          <details className="integration-details">
            <summary>{phrase('Opcje zaawansowane', 'Advanced options')}</summary>
            <label>Client Secret <small className="muted">{phrase('Tylko dla klienta poufnego', 'Confidential clients only')}</small>
              <input type="password" value={clientSecret} onChange={event => setClientSecret(event.target.value)} autoComplete="off" maxLength={512}
                placeholder={x.hasSecret ? phrase('Zapisano sekret', 'Secret saved') : undefined} />
            </label>
          </details>
          <p>{phrase('Kliknij Zapisz i połącz z X. Na stronie X zatwierdź dostęp przyciskiem Authorize app. Po zatwierdzeniu wrócisz do Integracji.', 'Click Save and connect to X. On X, choose Authorize app. After approval, you will return to Integrations.')}</p>
          <small className="muted">{xIdentityCost()}</small>
        </>}
      </section>
      {Boolean(error) && <ErrorBanner error={error} />}
      <div className="setup-navigation">
        <Button onClick={step > 0 ? () => setStep(step - 1) : close} disabled={busy}>{step > 0 ? phrase('Wstecz', 'Back') : tr("Anuluj")}</Button>
        <div className="row-actions">
          {step < lastStep && <>
            <Button tone="quiet" onClick={() => setStep(lastStep)}>{phrase('Mam już Client ID', 'I have a Client ID')}</Button>
            <Button tone="primary" onClick={() => setStep(step + 1)}>{phrase('Dalej', 'Next')}</Button>
          </>}
          {step === lastStep && <>
            {x.configured && <Button type="submit" value="save" disabled={busy || !validClientId}>{tr("Zapisz ustawienia")}</Button>}
            <Button tone="primary" type="submit" value="connect" disabled={busy || !validClientId}>
              {busy ? tr("Zapisywanie…") : phrase('Zapisz i połącz z X', 'Save and connect to X')}
            </Button>
          </>}
        </div>
      </div>
    </form>
  </Dialog>;
}
