import { FormEvent, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, HeartHandshake, MapPin, Search, ShieldCheck } from 'lucide-react';
import { api, type PublicAttribution, type PublicLocation, type PublicLocationList } from './api';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('nl-NL', { dateStyle: 'long' }).format(new Date(value));
}

export function ResidentApp() {
  const [query, setQuery] = useState('');
  const [locations, setLocations] = useState<PublicLocation[]>([]);
  const [attributions, setAttributions] = useState<PublicAttribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reportingId, setReportingId] = useState<string>();
  const [reportReason, setReportReason] = useState('');
  const [reportMessage, setReportMessage] = useState('');

  async function search(value = query): Promise<void> {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (value.trim()) params.set('query', value.trim());
      const [response, sourceAttributions] = await Promise.all([
        api.request<PublicLocationList>(`/api/public/locations?${params}`),
        api.request<PublicAttribution[]>('/api/public/attributions'),
      ]);
      setLocations(response.items);
      setAttributions(sourceAttributions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'De kastjes konden niet worden geladen.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void search(''); }, []);

  async function submitSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await search();
  }

  async function submitReport(event: FormEvent<HTMLFormElement>, location: PublicLocation): Promise<void> {
    event.preventDefault();
    setError('');
    try {
      await api.request(`/api/public/locations/${location.id}/reports`, {
        method: 'POST',
        body: JSON.stringify({ reason: reportReason }),
      });
      setReportMessage('Bedankt. We controleren de melding voordat er iets verandert.');
      setReportingId(undefined);
      setReportReason('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'De melding kon niet worden verstuurd.');
    }
  }

  return <main className="resident-page">
    <header className="resident-header">
      <a className="resident-brand" href="/" aria-label="Weggeefkastje.nl, naar overzicht"><span><HeartHandshake /></span><strong>Weggeefkastje.nl</strong></a>
      <a className="resident-admin-link" href="/beheer">Beheer</a>
    </header>
    <section className="resident-hero">
      <p className="resident-kicker">VIND EEN KASTJE IN JE BUURT</p>
      <h1>Pak of geef iets door.</h1>
      <p>Hier vind je openbare weggeefkastjes met een gecontroleerd, exact adres. Je hebt geen account nodig.</p>
      <form className="resident-search-form" onSubmit={submitSearch} aria-label="Zoek een weggeefkastje">
        <label htmlFor="resident-query">Plaats, postcode of straat</label>
        <div><Search aria-hidden="true" /><input id="resident-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Bijvoorbeeld Utrecht of 3511" /><button className="primary" type="submit" disabled={loading}>{loading ? 'Zoeken…' : 'Zoeken'}</button></div>
      </form>
      <p className="resident-privacy"><ShieldCheck aria-hidden="true" />We vragen niet om je locatie en bewaren geen profielgegevens.</p>
    </section>
    <section className="resident-results" aria-live="polite">
      <div className="resident-results-heading"><div><p className="eyebrow">KASTJES</p><h2>{loading ? 'Even zoeken…' : locations.length === 1 ? '1 kastje gevonden' : `${locations.length} kastjes gevonden`}</h2></div><p>Alleen locaties die exact zijn gecontroleerd, verschijnen hier.</p></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {reportMessage && <p className="resident-success" role="status"><CheckCircle2 aria-hidden="true" />{reportMessage}</p>}
      {!loading && locations.length === 0 && <div className="resident-empty"><MapPin aria-hidden="true" /><h3>Nog geen gecontroleerd kastje gevonden</h3><p>Probeer een andere plaats of postcode. Een kastje zonder exact bevestigd adres wordt hier bewust niet getoond.</p></div>}
      <div className="resident-location-grid">
        {locations.map((location) => <article className="resident-location" key={location.id}>
          <div className="resident-location-icon"><MapPin aria-hidden="true" /></div>
          <div className="resident-location-main"><h3>{location.title}</h3><address>{location.addressLine}<br />{location.postalCode} {location.city}</address>{location.categories.length > 0 && <p className="resident-categories">{location.categories.join(' · ')}</p>}<p className="resident-verified">Laatst gecontroleerd: {formatDate(location.lastVerifiedAt)}</p></div>
          <div className="resident-location-actions"><a className="primary" href={location.directionsUrl} target="_blank" rel="noreferrer">Route <ArrowRight aria-hidden="true" /></a><button className="text-button" type="button" onClick={() => { setReportingId(reportingId === location.id ? undefined : location.id); setReportMessage(''); }}>Kloppen de gegevens niet?</button></div>
          {reportingId === location.id && <form className="resident-report" onSubmit={(event) => void submitReport(event, location)}><label htmlFor={`report-${location.id}`}>Wat klopt er niet?<textarea id={`report-${location.id}`} value={reportReason} onChange={(event) => setReportReason(event.target.value)} minLength={3} maxLength={800} required placeholder="Bijvoorbeeld: het kastje staat er niet meer." /></label><p>Laat geen namen, telefoonnummers of andere persoonsgegevens achter.</p><div><button className="secondary" type="button" onClick={() => setReportingId(undefined)}>Annuleren</button><button className="primary" type="submit">Melding versturen</button></div></form>}
        </article>)}
      </div>
    </section>
    <footer className="resident-footer"><p>Beheer je een kastje? Gebruik de persoonlijke beheerlink die je van het project ontvangt.</p>{attributions.length > 0 && <p className="resident-attributions">Bronnen voor getoonde locaties: {attributions.map((source) => `${source.name} — ${source.attribution}`).join(' · ')}</p>}</footer>
  </main>;
}
