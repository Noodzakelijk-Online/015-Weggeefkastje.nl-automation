import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Archive, Bell, Check, ChevronLeft, ChevronRight, Clipboard, FilePlus2, HeartHandshake, Home, Inbox,
  LoaderCircle, LogOut, Menu, MessageCircle, PackageCheck, Search, Settings, ShieldAlert,
  Sparkles, X,
} from 'lucide-react';
import { api, type Item, type ItemDetail, type Session } from './api';

const statusLabels: Record<string, string> = {
  draft: 'Concept', rules_review: 'Regels controleren', human_review: 'Beoordelen',
  ready_to_post: 'Klaar om te plaatsen', posted: 'Geplaatst', responding: 'Reacties',
  pickup_scheduled: 'Afspraak', completed: 'Opgehaald', rejected: 'Afgewezen',
  cancelled: 'Geannuleerd', archived: 'Gearchiveerd',
};

const actionLabels: Record<string, string> = {
  submit: 'Naar beoordeling', rules_passed: 'Regels akkoord', approve: 'Goedkeuren', reject: 'Afwijzen',
  return_to_review: 'Terug naar beoordeling', mark_posted: 'Markeer als geplaatst', record_response: 'Reactie vastleggen',
  schedule_pickup: 'Afspraak plannen', complete_pickup: 'Markeer als opgehaald', cancel: 'Annuleren', archive: 'Archiveren',
};

type View = 'overview' | 'intake' | 'review' | 'publish' | 'coordinate' | 'archive' | 'settings';

const viewStatuses: Partial<Record<View, string[]>> = {
  overview: ['rules_review', 'human_review', 'ready_to_post', 'responding', 'pickup_scheduled'],
  intake: ['draft', 'rules_review'],
  review: ['rules_review', 'human_review'],
  publish: ['ready_to_post', 'posted'],
  coordinate: ['responding', 'pickup_scheduled', 'completed'],
  archive: ['archived', 'rejected', 'cancelled'],
};

function Login({ onReady }: { onReady: (session: Session) => void }) {
  const [setupRequired, setSetupRequired] = useState<boolean>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.request<{ setupRequired: boolean }>('/api/setup/status').then((result) => setSetupRequired(result.setupRequired)).catch((cause) => setError(cause.message)); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    try { onReady(await api.signIn(setupRequired ? '/api/setup' : '/api/auth/login', data)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Aanmelden mislukt.'); }
    finally { setBusy(false); }
  }

  if (setupRequired === undefined && !error) return <div className="splash"><LoaderCircle className="spin" /><span>Veilige werkruimte laden…</span></div>;
  return <main className="login-page">
    <section className="login-card">
      <div className="brand-mark"><HeartHandshake /></div>
      <p className="eyebrow">WEGGEEFKASTJE.NL</p>
      <h1>{setupRequired ? 'Maak je werkruimte klaar' : 'Welkom terug'}</h1>
      <p className="muted">Beheer vermeldingen, beoordeling en plaatsing vanuit één rustige werkstroom.</p>
      <form onSubmit={submit}>
        {setupRequired && <><label>Jouw naam<input name="displayName" required minLength={2} autoComplete="name" /></label><label>Naam werkruimte<input name="workspaceName" required minLength={2} defaultValue="Weggeefkastje beheer" /></label></>}
        <label>E-mailadres<input name="email" required type="email" autoComplete="email" /></label>
        <label>Wachtwoord<input name="password" required type="password" minLength={setupRequired ? 12 : 1} autoComplete={setupRequired ? 'new-password' : 'current-password'} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary wide" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : setupRequired ? 'Werkruimte aanmaken' : 'Inloggen'}</button>
      </form>
      <p className="safety-note"><ShieldAlert /> Plaatsen gebeurt altijd handmatig en na jouw controle.</p>
    </section>
  </main>;
}

function IntakeDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (detail: ItemDetail) => void }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const detail = await api.request<ItemDetail>('/api/items', { method: 'POST', body: JSON.stringify({
        title: form.title, description: form.description, category: form.category,
        platformTarget: form.platformTarget, sourceKind: 'manual', sourceName: 'operator-intake',
        city: form.city, addressHint: form.addressHint || undefined, confidence: 50,
        contactMethod: 'platform', privacyLevel: 'approximate',
      }) });
      onCreated(detail);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Opslaan mislukt.'); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="intake-title">
      <button className="icon-button modal-close" onClick={onClose} aria-label="Sluiten"><X /></button>
      <p className="eyebrow">NIEUWE INTAKE</p><h2 id="intake-title">Voeg een kans toe</h2><p className="muted">Leg alleen vast wat nodig is. Contactgegevens horen niet in openbare tekst.</p>
      <form className="intake-form" onSubmit={submit}>
        <label>Titel<input name="title" required minLength={3} placeholder="Bijv. speelgoed zoekt een nieuw huis" /></label>
        <label>Beschrijving<textarea name="description" required minLength={3} rows={5} placeholder="Wat wordt aangeboden en wat moet de ontvanger weten?" /></label>
        <div className="form-grid"><label>Categorie<select name="category" defaultValue="Overig"><option>Overig</option><option>Boeken</option><option>Kleding</option><option>Speelgoed</option><option>Houdbare producten</option><option>Planten</option></select></label><label>Doelplatform<select name="platformTarget"><option value="facebook">Facebook</option><option value="nextdoor">Nextdoor</option><option value="weggeefkastje">Weggeefkastje.nl</option><option value="manual">Anders</option></select></label></div>
        <div className="form-grid"><label>Plaats<input name="city" required minLength={2} /></label><label>Adresindicatie<input name="addressHint" placeholder="Geen huisnummer nodig" /></label></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Annuleren</button><button className="primary" disabled={busy}>{busy ? 'Opslaan…' : 'Opslaan als concept'}</button></div>
      </form>
    </section>
  </div>;
}

function DetailDrawer({ detail, onClose, onChanged }: { detail: ItemDetail; onClose: () => void; onChanged: (detail: ItemDetail) => void }) {
  const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  async function action(name: string) {
    setBusy(name); setError('');
    try {
      let externalUrl: string | undefined;
      let scheduledAt: string | undefined;
      if (['reject', 'cancel', 'archive'].includes(name) && !window.confirm(`Weet je zeker dat je deze vermelding wilt ${name === 'reject' ? 'afwijzen' : name === 'cancel' ? 'annuleren' : 'archiveren'}?`)) return;
      if (name === 'mark_posted') {
        if (!window.confirm('Bevestig dat je dit bericht zelf op het gekozen platform hebt geplaatst.')) return;
        externalUrl = window.prompt('Optioneel: plak de link naar het geplaatste bericht.')?.trim() || undefined;
      }
      const notes = ['record_response', 'schedule_pickup'].includes(name) ? window.prompt(name === 'record_response' ? 'Korte notitie bij de reactie:' : 'Afspraaknotitie:') ?? undefined : undefined;
      if (['record_response', 'schedule_pickup'].includes(name) && !notes) return;
      if (name === 'schedule_pickup') {
        const entered = window.prompt('Datum en tijd (bijv. 2026-08-15 13:00):');
        if (!entered) return;
        const parsed = new Date(entered.replace(' ', 'T'));
        if (Number.isNaN(parsed.getTime())) throw new Error('Gebruik een geldige datum en tijd.');
        scheduledAt = parsed.toISOString();
      }
      onChanged(await api.request<ItemDetail>(`/api/items/${detail.item.id}/actions`, { method: 'POST', body: JSON.stringify({ action: name, notes, externalUrl, scheduledAt, idempotencyKey: `${name}-${crypto.randomUUID()}` }) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Actie mislukt.'); }
    finally { setBusy(''); }
  }
  async function copyPackage() {
    if (!detail.messagePackage?.body) return;
    setBusy('copy'); setError('');
    try {
      await navigator.clipboard.writeText([detail.messagePackage.subject, detail.messagePackage.body].filter(Boolean).join('\n\n'));
      onChanged(await api.request<ItemDetail>(`/api/items/${detail.item.id}/message-package/copy`, { method: 'POST', body: JSON.stringify({ idempotencyKey: `copy-${crypto.randomUUID()}` }) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Kopiëren mislukt.'); }
    finally { setBusy(''); }
  }
  return <aside className="drawer" aria-label={`Details van ${detail.item.title}`}>
    <header className="drawer-header"><div><span className={`status status-${detail.item.status}`}>{statusLabels[detail.item.status] ?? detail.item.status}</span><h2>{detail.item.title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Details sluiten"><X /></button></header>
    <div className="drawer-body">
      <div className="workflow-rail"><span className="done"><Check /></span><i /><span className={['human_review','ready_to_post','posted','responding','pickup_scheduled','completed'].includes(detail.item.status) ? 'done' : ''}>2</span><i /><span className={['ready_to_post','posted','responding','pickup_scheduled','completed'].includes(detail.item.status) ? 'done' : ''}>3</span><i /><span className={['posted','responding','pickup_scheduled','completed'].includes(detail.item.status) ? 'done' : ''}>4</span></div>
      <section><h3>Over deze vermelding</h3><p>{detail.item.description}</p><dl className="facts"><div><dt>Categorie</dt><dd>{detail.item.category}</dd></div><div><dt>Plaats</dt><dd>{detail.item.city}</dd></div><div><dt>Platform</dt><dd>{detail.item.platformTarget}</dd></div><div><dt>Betrouwbaarheid</dt><dd>{detail.item.confidence}%</dd></div><div><dt>Bron</dt><dd>{detail.item.sourceName}</dd></div></dl></section>
      {detail.latestRules && <section><h3>Veiligheidscontrole</h3><ul className="rules">{detail.latestRules.results.map((rule) => <li key={rule.key} className={rule.passed ? 'pass' : 'fail'}><span>{rule.passed ? <Check /> : <X />}</span>{rule.message}</li>)}</ul></section>}
      {detail.messagePackage?.body && <section><div className="section-heading"><h3>Plaatsingspakket</h3><button className="text-button" onClick={copyPackage} disabled={Boolean(busy)}><Clipboard />{detail.messagePackage.copiedAt ? 'Opnieuw kopiëren' : 'Kopiëren'}</button></div><div className="message-preview"><strong>{detail.messagePackage.subject}</strong><p>{detail.messagePackage.body}</p></div></section>}
      {(detail.coordination.length > 0 || detail.history.length > 0) && <section><h3>Activiteit en afspraken</h3><ol className="activity-list">
        {detail.coordination.map((entry) => <li key={entry.createdAt + entry.eventType}><span>{entry.eventType === 'pickup_scheduled' ? 'Afspraak' : entry.eventType === 'pickup_completed' ? 'Opgehaald' : 'Notitie'}</span>{entry.notes && <p>{entry.notes}</p>}{entry.scheduledAt && <time dateTime={entry.scheduledAt}>Gepland: {new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.scheduledAt))}</time>}</li>)}
        {detail.history.slice(0, 5).map((entry) => <li key={entry.createdAt + entry.action}><span>{actionLabels[entry.action] ?? entry.action}</span><time dateTime={entry.createdAt}>{new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt))}</time></li>)}
      </ol></section>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <footer className="drawer-actions">{detail.availableActions.map((name) => {
      const needsCopy = name === 'mark_posted' && !detail.messagePackage?.copiedAt;
      return <button key={name} className={['approve','mark_posted','complete_pickup'].includes(name) ? 'primary' : 'secondary'} onClick={() => action(name)} disabled={Boolean(busy) || needsCopy} title={needsCopy ? 'Kopieer en controleer eerst het plaatsingspakket.' : undefined}>{busy === name ? 'Bezig…' : needsCopy ? 'Kopieer eerst het pakket' : actionLabels[name] ?? name}</button>;
    })}</footer>
  </aside>;
}

export function App() {
  const [session, setSession] = useState<Session>(); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [view, setView] = useState<View>('overview'); const [items, setItems] = useState<Item[]>([]); const [counts, setCounts] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<ItemDetail>(); const [intake, setIntake] = useState(false); const [search, setSearch] = useState(''); const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState<Record<string, unknown>>(); const [reviewCount, setReviewCount] = useState(0);
  const [page, setPage] = useState(1); const [total, setTotal] = useState(0); const pageSize = 25;
  const [mentions, setMentions] = useState<Array<{ id: string; platform: string; sourceName: string; sourceLink?: string; summary: string; observedAt: string }>>([]);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const statuses = viewStatuses[view] ?? [];
      const query = new URLSearchParams({ page: String(page), limit: String(pageSize), includeArchived: String(view === 'archive') });
      if (statuses.length) query.set('status', statuses.join(','));
      if (search.trim()) query.set('query', search.trim());
      const [dashboard, itemEnvelope, reviewSummary] = await Promise.all([
        api.request<{ counts: Record<string, number> }>('/api/dashboard'),
        view === 'settings' ? Promise.resolve({ data: [] as Item[], meta: { total: 0 } }) : api.requestEnvelope<Item[]>(`/api/items?${query}`),
        api.request<{ ambiguousMentions: number }>('/api/review/summary'),
      ]);
      setCounts(dashboard.counts); setItems(itemEnvelope.data); setTotal(itemEnvelope.meta?.total ?? itemEnvelope.data.length);
      setReviewCount((dashboard.counts.rules_review ?? 0) + (dashboard.counts.human_review ?? 0) + reviewSummary.ambiguousMentions);
      if (view === 'review') {
        const review = await api.request<{ ambiguousMentions: unknown[] }>('/api/review');
        setMentions(review.ambiguousMentions as Array<{ id: string; platform: string; sourceName: string; sourceLink?: string; summary: string; observedAt: string }>);
      } else setMentions([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Vernieuwen mislukt.'); }
  }, [page, search, session, view]);

  useEffect(() => {
    api.request<{ setupRequired: boolean }>('/api/setup/status')
      .then((status) => status.setupRequired ? undefined : api.me().then(setSession))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 250); return () => window.clearTimeout(timer); }, [refresh]);
  useEffect(() => { setPage(1); }, [view, search]);
  useEffect(() => { if (view === 'settings' && session) api.request<Record<string, unknown>>('/api/settings').then(setSettings).catch((cause) => setError(cause.message)); }, [view, session]);

  const visibleItems = items;

  async function openItem(id: string) { try { setSelected(await api.request<ItemDetail>(`/api/items/${id}`)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Details laden mislukt.'); } }
  async function logout() { await api.request('/api/auth/logout', { method: 'POST', body: '{}' }); api.csrfToken = ''; setSession(undefined); }
  async function dismissMention(id: string) { try { await api.request(`/api/review/mentions/${id}/dismiss`, { method: 'POST', body: '{}' }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Melding bijwerken mislukt.'); } }
  async function toggleSafetyStop() { try { const enabled = !settings?.safetyStop; await api.request('/api/operator/safety-stop', { method: 'POST', body: JSON.stringify({ enabled }) }); setSettings({ ...settings, safetyStop: enabled }); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Veiligheidsstop wijzigen mislukt.'); } }

  if (loading) return <div className="splash"><LoaderCircle className="spin" /><span>Werkruimte laden…</span></div>;
  if (!session) return <Login onReady={setSession} />;

  const nav = [
    ['overview','Overzicht',Home], ['intake','Intake',Inbox], ['review','Beoordelen',Sparkles], ['publish','Publiceren',PackageCheck],
    ['coordinate','Coördinatie',MessageCircle], ['archive','Archief',Archive], ['settings','Instellingen',Settings],
  ] as const;
  const heading = view === 'overview' ? 'Wat heeft aandacht nodig?' : nav.find(([key]) => key === view)?.[1];
  return <div className="app-shell">
    <aside className={`sidebar ${menu ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><HeartHandshake /></div><div><strong>Weggeefkastje</strong><span>Automatisering</span></div></div>
      <nav>{nav.map(([key,label,Icon]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => { setView(key); setMenu(false); }}><Icon />{label}{key === 'review' && reviewCount > 0 && <b>{reviewCount}</b>}</button>)}</nav>
      <div className="sidebar-profile"><div className="avatar">{session.displayName.slice(0,2).toUpperCase()}</div><div><strong>{session.displayName}</strong><span>{session.role}</span></div><button className="icon-button light" onClick={logout} aria-label="Uitloggen"><LogOut /></button></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><button className="icon-button menu-button" onClick={() => setMenu(!menu)} aria-label="Menu"><Menu /></button><div className="search"><Search /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Zoek op titel, plaats of categorie" aria-label="Zoeken" /></div><button className="icon-button notification" onClick={() => setView('review')} aria-label="Meldingen en beoordelingen"><Bell />{reviewCount > 0 && <i />}</button><button className="primary new-button" onClick={() => setIntake(true)}><FilePlus2 />Nieuwe intake</button></header>
      <section className="content">
        <div className="page-heading"><div><p className="eyebrow">{session.workspaceName.toUpperCase()}</p><h1>{heading}</h1><p className="muted">{view === 'overview' ? 'Werk de belangrijkste stappen af en houd de overdracht persoonlijk.' : 'Alle gegevens blijven onder menselijke controle.'}</p></div></div>
        <div className="manual-alert"><ShieldAlert /><div><strong>Plaatsen gebeurt handmatig — er wordt niets automatisch gepubliceerd.</strong><span>Controleer ieder bericht, kopieer het pakket en plaats het zelf op het gekozen platform.</span></div></div>
        {error && <p className="form-error page-error" role="alert">{error}<button onClick={() => setError('')}><X /></button></p>}
        {view === 'overview' && <div className="stats"><article><span>Te beoordelen</span><strong>{(counts.rules_review ?? 0) + (counts.human_review ?? 0)}</strong><small>controle nodig</small></article><article><span>Klaar om te plaatsen</span><strong>{counts.ready_to_post ?? 0}</strong><small>handmatige stap</small></article><article><span>Coördinatie</span><strong>{(counts.responding ?? 0) + (counts.pickup_scheduled ?? 0)}</strong><small>reacties en afspraken</small></article></div>}
        {view === 'settings' ? <section className="settings-panel"><h2>Werkruimte-instellingen</h2>{settings ? <><dl className="settings-list">{Object.entries(settings).filter(([key]) => !['featureFlags','safetyStop'].includes(key)).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{String(value ?? '—')}</dd></div>)}</dl>{session.role === 'owner' && <div className="safety-control"><div><strong>Veiligheidsstop</strong><p>Blokkeert providerintake door de worker. Handmatige gegevens blijven beschikbaar.</p></div><button className={settings.safetyStop ? 'primary' : 'secondary'} onClick={toggleSafetyStop}>{settings.safetyStop ? 'Veiligheidsstop uitschakelen' : 'Veiligheidsstop inschakelen'}</button></div>}</> : <LoaderCircle className="spin" />}<p className="safety-note"><ShieldAlert /> Providerverbindingen worden alleen via serverconfiguratie geactiveerd; geheimen worden nooit in deze pagina getoond.</p></section>
        : <section className="queue-card"><div className="queue-header"><div><h2>{view === 'overview' ? 'Actieve werkstroom' : heading}</h2><span>{total} resultaten</span></div><button className="text-button" onClick={refresh}>Vernieuwen</button></div>
          {view === 'review' && mentions.length > 0 && <div className="mention-list">{mentions.map((mention) => <article key={mention.id}><div><span className="status status-rules_review">Locatie ontbreekt</span><h3>{mention.sourceName}</h3><p>{mention.summary}</p><small>{mention.platform} · {new Intl.DateTimeFormat('nl-NL').format(new Date(mention.observedAt))}</small></div><div>{mention.sourceLink && <a className="secondary" href={mention.sourceLink} target="_blank" rel="noreferrer">Bron bekijken</a>}<button className="text-button" onClick={() => dismissMention(mention.id)}>Niet bruikbaar</button></div></article>)}</div>}
          <div className="item-list" role="table" aria-label="Werkstroom"><div className="list-head" role="row"><span>Vermelding</span><span>Fase</span><span>Locatie</span><span>Bijgewerkt</span><span /></div>
            {visibleItems.map((item) => <button className="item-row" role="row" key={item.id} onClick={() => openItem(item.id)}><span className="item-main"><i className={`source source-${item.platformTarget}`}>{item.platformTarget.slice(0,1).toUpperCase()}</i><span><strong>{item.title}</strong><small>{item.category} · {item.sourceName}</small></span></span><span><i className={`status status-${item.status}`}>{statusLabels[item.status] ?? item.status}</i></span><span>{item.city}</span><span>{new Intl.DateTimeFormat('nl-NL', { day:'numeric', month:'short' }).format(new Date(item.updatedAt))}</span><span><ChevronRight /></span></button>)}
            {visibleItems.length === 0 && <div className="empty"><PackageCheck /><h3>Hier is alles bijgewerkt</h3><p>Nieuwe of geïmporteerde vermeldingen verschijnen hier zodra ze aandacht nodig hebben.</p><button className="primary" onClick={() => setIntake(true)}>Nieuwe intake</button></div>}
          </div>{total > pageSize && <nav className="pagination" aria-label="Paginering"><button className="secondary" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft />Vorige</button><span>Pagina {page} van {Math.ceil(total / pageSize)}</span><button className="secondary" disabled={page * pageSize >= total} onClick={() => setPage((value) => value + 1)}>Volgende<ChevronRight /></button></nav>}</section>}
      </section>
    </main>
    {selected && <DetailDrawer detail={selected} onClose={() => setSelected(undefined)} onChanged={(detail) => { setSelected(detail); void refresh(); }} />}
    {intake && <IntakeDialog onClose={() => setIntake(false)} onCreated={(detail) => { setIntake(false); setSelected(detail); void refresh(); }} />}
  </div>;
}
