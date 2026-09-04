import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Check, LoaderCircle, Plus, RotateCcw, ShieldCheck } from 'lucide-react';
import { api } from '../api';

type AccessMode = 'official_api' | 'approved_export' | 'open_data' | 'owner_authorized' | 'manual';
type PublicationMode = 'automatic' | 'review';

interface Source {
  id: string;
  key: string;
  name: string;
  accessMode: AccessMode;
  authorizationReference: string;
  attribution: string;
  publicationMode: PublicationMode;
  enabled: boolean;
  allowsExactAddress: boolean;
  lastCheckedAt?: string;
  lastStatus?: string;
  updatedAt: string;
}

const accessLabels: Record<AccessMode, string> = {
  official_api: 'Officiële API',
  approved_export: 'Goedgekeurde export',
  open_data: 'Open data',
  owner_authorized: 'Schriftelijk gemachtigd',
  manual: 'Handmatige invoer',
};

function initialForm() {
  return {
    key: '', name: '', accessMode: 'approved_export' as AccessMode, authorizationReference: '', attribution: '',
    publicationMode: 'review' as PublicationMode, enabled: false, allowsExactAddress: false,
  };
}

export function SourceRegistryView() {
  const [sources, setSources] = useState<Source[]>([]);
  const [form, setForm] = useState(initialForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSources(await api.request<Source[]>('/api/sources'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Bronnen konden niet worden geladen.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function createSource(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    if (form.publicationMode === 'automatic' && (!form.enabled || !form.allowsExactAddress)) {
      setError('Automatisch publiceren vereist een ingeschakelde bron én expliciete toestemming voor exacte adressen.');
      return;
    }
    setBusy('create');
    try {
      await api.request('/api/sources', { method: 'POST', body: JSON.stringify(form) });
      setForm(initialForm());
      setShowForm(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Bron opslaan mislukt.');
    } finally {
      setBusy('');
    }
  }

  async function updateSource(source: Source, changes: Partial<Pick<Source, 'publicationMode' | 'enabled' | 'allowsExactAddress'>>): Promise<void> {
    const next = { ...source, ...changes };
    if (next.publicationMode === 'automatic' && (!next.enabled || !next.allowsExactAddress)) {
      setError('Automatisch publiceren kan alleen met een ingeschakelde bron en toestemming voor exacte adressen.');
      return;
    }
    setBusy(source.id);
    setError('');
    try {
      await api.request(`/api/sources/${source.id}`, { method: 'PATCH', body: JSON.stringify(changes) });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Bronbeleid wijzigen mislukt.');
    } finally {
      setBusy('');
    }
  }

  return <section className="sources-panel" aria-labelledby="sources-title">
    <div className="catalog-heading"><div><p className="eyebrow">TOESTEMMING EN HERKOMST</p><h2 id="sources-title">Bronnenregister</h2><p className="muted">Elke bron heeft een toegangsvorm, schriftelijke referentie, naamsvermelding en eigen publicatieregel.</p></div><div><button className="text-button" onClick={() => void refresh()} disabled={loading}><RotateCcw />Vernieuwen</button><button className="primary" onClick={() => setShowForm((value) => !value)}><Plus />Bron toevoegen</button></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {showForm && <form className="source-form" onSubmit={createSource}><h3>Nieuwe toegestane bron</h3><div className="form-grid"><label>Interne sleutel<input value={form.key} onChange={(event) => setForm({ ...form, key: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} required minLength={3} maxLength={80} placeholder="bijv. utrecht-partnerkaart" /></label><label>Naam<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={3} maxLength={160} /></label></div><div className="form-grid"><label>Toegangsvorm<select value={form.accessMode} onChange={(event) => setForm({ ...form, accessMode: event.target.value as AccessMode })}>{Object.entries(accessLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Naamsvermelding<input value={form.attribution} onChange={(event) => setForm({ ...form, attribution: event.target.value })} required minLength={2} maxLength={300} placeholder="Bijv. © OpenStreetMap-bijdragers" /></label></div><label>Referentie voor toestemming of licentie<input value={form.authorizationReference} onChange={(event) => setForm({ ...form, authorizationReference: event.target.value })} required minLength={3} maxLength={500} placeholder="Bijv. contractnummer of vastgelegde toestemming" /></label><fieldset><legend>Publiceren</legend><label className="check-field"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />Deze bron is ingeschakeld</label><label className="check-field"><input type="checkbox" checked={form.allowsExactAddress} onChange={(event) => setForm({ ...form, allowsExactAddress: event.target.checked })} />De toestemming omvat exacte adressen</label><label>Standaardactie<select value={form.publicationMode} onChange={(event) => setForm({ ...form, publicationMode: event.target.value as PublicationMode })}><option value="review">Eerst beoordelen</option><option value="automatic">Automatisch na exacte adrescontrole</option></select></label></fieldset><p className="safety-note"><ShieldCheck />Privégroepen horen alleen hier thuis met schriftelijke toestemming van de beheerder én een ondersteunde, toegestane export of API.</p><div className="modal-actions"><button className="secondary" type="button" onClick={() => setShowForm(false)}>Annuleren</button><button className="primary" disabled={busy === 'create'}>{busy === 'create' ? 'Opslaan…' : <><Check />Bron opslaan</>}</button></div></form>}
    {loading ? <div className="catalog-loading"><LoaderCircle className="spin" />Bronnen laden…</div> : <div className="source-list" role="list">{sources.map((source) => <article key={source.id} role="listitem"><div><div className="catalog-statuses"><span className={`status ${source.enabled ? 'status-completed' : 'status-archived'}`}>{source.enabled ? 'Ingeschakeld' : 'Uitgeschakeld'}</span><span className={`status ${source.publicationMode === 'automatic' ? 'status-posted' : 'status-rules_review'}`}>{source.publicationMode === 'automatic' ? 'Automatisch' : 'Beoordelen'}</span></div><h3>{source.name}</h3><p>{accessLabels[source.accessMode]} · {source.attribution}</p><small>Referentie: {source.authorizationReference} · {source.lastCheckedAt ? `Laatst gecontroleerd: ${new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(source.lastCheckedAt))}` : 'Nog niet gecontroleerd'}</small></div><div className="source-controls"><label className="check-field"><input type="checkbox" checked={source.enabled} disabled={Boolean(busy)} onChange={(event) => void updateSource(source, event.target.checked ? { enabled: true } : { enabled: false, publicationMode: 'review' })} />Ingeschakeld</label><label className="check-field"><input type="checkbox" checked={source.allowsExactAddress} disabled={Boolean(busy)} onChange={(event) => void updateSource(source, event.target.checked ? { allowsExactAddress: true } : { allowsExactAddress: false, publicationMode: 'review' })} />Exact adres toegestaan</label><label>Publicatieregel<select value={source.publicationMode} disabled={Boolean(busy)} onChange={(event) => void updateSource(source, { publicationMode: event.target.value as PublicationMode })}><option value="review">Eerst beoordelen</option><option value="automatic">Automatisch</option></select></label></div></article>)}{sources.length === 0 && <div className="empty"><ShieldCheck /><h3>Geen bronnen geregistreerd</h3><p>Voeg alleen een bron toe als toegang, licentie of schriftelijke toestemming vastligt.</p></div>}</div>}
  </section>;
}
