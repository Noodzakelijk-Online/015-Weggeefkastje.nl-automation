import { useCallback, useEffect, useState } from 'react';
import { Check, Clipboard, ExternalLink, Link2, LoaderCircle, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { api } from '../api';

interface ResidentLocation {
  id: string;
  title: string;
  addressLine: string;
  postalCode: string;
  city: string;
  status: 'active' | 'inactive' | 'removed';
  publicationStatus: 'published' | 'review';
  categories: string[];
  lastVerifiedAt: string;
  updatedAt: string;
}

interface UpdateRequest {
  id: string;
  locationId?: string;
  requestType: 'candidate' | 'public_report' | 'source_review';
  reason: string;
  createdAt: string;
}

interface CaretakerLink {
  id: string;
  expiresAt: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

interface CreatedCaretakerLink {
  id: string;
  locationId: string;
  expiresAt: string;
  url: string;
}

function date(value: string): string {
  return new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function ResidentCatalogView() {
  const [locations, setLocations] = useState<ResidentLocation[]>([]);
  const [requests, setRequests] = useState<UpdateRequest[]>([]);
  const [links, setLinks] = useState<CaretakerLink[]>([]);
  const [linksFor, setLinksFor] = useState<string>();
  const [createdLink, setCreatedLink] = useState<CreatedCaretakerLink>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [catalog, updates] = await Promise.all([
        api.request<{ items: ResidentLocation[] }>('/api/resident-locations?includeReview=true&limit=100'),
        api.request<{ items: UpdateRequest[] }>('/api/location-update-requests?status=pending'),
      ]);
      setLocations(catalog.items);
      setRequests(updates.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'De catalogus kon niet worden geladen.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function publish(location: ResidentLocation): Promise<void> {
    setBusy(`publish:${location.id}`);
    setError('');
    try {
      await api.request(`/api/resident-locations/${location.id}/publish`, { method: 'POST', body: '{}' });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Publiceren mislukt.');
    } finally {
      setBusy('');
    }
  }

  async function createCaretakerLink(location: ResidentLocation): Promise<void> {
    setBusy(`link:${location.id}`);
    setError('');
    setCopied(false);
    try {
      const link = await api.request<CreatedCaretakerLink>(`/api/resident-locations/${location.id}/caretaker-links`, {
        method: 'POST', body: JSON.stringify({ expiresInDays: 180 }),
      });
      setCreatedLink(link);
      setLinksFor(undefined);
      setLinks([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'De beheerlink kon niet worden gemaakt.');
    } finally {
      setBusy('');
    }
  }

  async function showLinks(locationId: string): Promise<void> {
    setBusy(`links:${locationId}`);
    setError('');
    try {
      const values = await api.request<CaretakerLink[]>(`/api/resident-locations/${locationId}/caretaker-links`);
      setLinksFor(locationId);
      setLinks(values);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Beheerlinks konden niet worden geladen.');
    } finally {
      setBusy('');
    }
  }

  async function revokeLink(link: CaretakerLink): Promise<void> {
    if (!linksFor) return;
    setBusy(`revoke:${link.id}`);
    setError('');
    try {
      await api.request(`/api/caretaker-links/${link.id}`, { method: 'DELETE', body: '{}' });
      await showLinks(linksFor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'De beheerlink kon niet worden ingetrokken.');
    } finally {
      setBusy('');
    }
  }

  async function resolveRequest(request: UpdateRequest, status: 'resolved' | 'dismissed'): Promise<void> {
    setBusy(`request:${request.id}`);
    setError('');
    try {
      await api.request(`/api/location-update-requests/${request.id}/resolve`, { method: 'POST', body: JSON.stringify({ status }) });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Het wijzigingsverzoek kon niet worden afgehandeld.');
    } finally {
      setBusy('');
    }
  }

  async function copyCreatedLink(): Promise<void> {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink.url);
      setCopied(true);
    } catch {
      setError('Kopiëren lukte niet automatisch. Selecteer en kopieer de link hieronder.');
    }
  }

  return <section className="catalog-panel" aria-labelledby="catalog-title">
    <div className="catalog-heading"><div><p className="eyebrow">BEWONERSVINDER</p><h2 id="catalog-title">Kastjescatalogus</h2><p className="muted">Alleen actieve locaties met een exact bevestigd adres kunnen publiek zichtbaar zijn.</p></div><button className="text-button" onClick={() => void refresh()} disabled={loading}><RotateCcw />Vernieuwen</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {createdLink && <section className="caretaker-link-result" aria-live="polite"><div><p className="eyebrow">EENMALIG TONEN</p><h3>Persoonlijke beheerlink</h3><p>De volledige link wordt alleen nu getoond. Een nieuwe link trekt eerdere actieve links voor dit kastje in.</p></div><button className="icon-button" onClick={() => setCreatedLink(undefined)} aria-label="Beheerlink sluiten"><X /></button><input value={createdLink.url} readOnly aria-label="Persoonlijke beheerlink" onFocus={(event) => event.currentTarget.select()} /><div><button className="secondary" onClick={() => void copyCreatedLink()}><Clipboard />{copied ? 'Gekopieerd' : 'Kopieer link'}</button><a className="text-button" href={createdLink.url} target="_blank" rel="noreferrer"><ExternalLink />Openen</a></div><small>Verloopt op {date(createdLink.expiresAt)}.</small></section>}
    <div className="catalog-summary"><article><span>In catalogus</span><strong>{locations.length}</strong></article><article><span>Te beoordelen</span><strong>{locations.filter((location) => location.publicationStatus === 'review').length}</strong></article><article><span>Nieuwe meldingen</span><strong>{requests.length}</strong></article></div>
    {loading ? <div className="catalog-loading"><LoaderCircle className="spin" />Catalogus laden…</div> : <div className="catalog-list" role="list" aria-label="Kastjes in catalogus">
      {locations.map((location) => <article className="catalog-location" key={location.id} role="listitem"><div><div className="catalog-statuses"><span className={`status ${location.publicationStatus === 'published' ? 'status-posted' : 'status-rules_review'}`}>{location.publicationStatus === 'published' ? 'Publiek' : 'Beoordelen'}</span><span className={`status ${location.status === 'active' ? 'status-completed' : 'status-archived'}`}>{location.status === 'active' ? 'Actief' : 'Niet zichtbaar'}</span></div><h3>{location.title}</h3><address>{location.addressLine}, {location.postalCode} {location.city}</address><p>Laatst adres bevestigd: {date(location.lastVerifiedAt)}</p></div><div className="catalog-actions">{location.publicationStatus === 'review' && location.status === 'active' && <button className="primary" onClick={() => void publish(location)} disabled={Boolean(busy)}>{busy === `publish:${location.id}` ? 'Publiceren…' : <><Check />Publiceer</>}</button>}<button className="secondary" onClick={() => void createCaretakerLink(location)} disabled={Boolean(busy)}>{busy === `link:${location.id}` ? 'Maken…' : <><Link2 />Beheerlink maken</>}</button><button className="text-button" onClick={() => void showLinks(location.id)} disabled={Boolean(busy)}>{busy === `links:${location.id}` ? 'Laden…' : 'Beheerlinks'}</button></div></article>)}
      {locations.length === 0 && <div className="empty"><ShieldCheck /><h3>Nog geen kastjes in de catalogus</h3><p>Een toegestane bron met een exact geverifieerd adres kan hier een locatie toevoegen.</p></div>}
    </div>}
    {linksFor && <section className="caretaker-links"><div className="section-heading"><div><p className="eyebrow">BEHEERLINKS</p><h3>Links voor dit kastje</h3></div><button className="icon-button" onClick={() => { setLinksFor(undefined); setLinks([]); }} aria-label="Beheerlinks sluiten"><X /></button></div>{links.length === 0 ? <p className="muted">Er zijn nog geen beheerlinks uitgegeven.</p> : <ul>{links.map((link) => <li key={link.id}><span>{link.revokedAt ? 'Ingetrokken' : new Date(link.expiresAt) <= new Date() ? 'Verlopen' : 'Actief'} · verloopt {date(link.expiresAt)}</span>{link.lastUsedAt && <small>Laatst gebruikt: {date(link.lastUsedAt)}</small>}{!link.revokedAt && new Date(link.expiresAt) > new Date() && <button className="text-button" onClick={() => void revokeLink(link)} disabled={Boolean(busy)}>{busy === `revoke:${link.id}` ? 'Intrekken…' : 'Intrekken'}</button>}</li>)}</ul>}</section>}
    <section className="location-requests"><div className="section-heading"><div><p className="eyebrow">MELDINGEN</p><h3>Openstaande wijzigingen</h3></div><span>{requests.length}</span></div>{requests.length === 0 ? <p className="muted">Geen openstaande meldingen.</p> : <ul>{requests.map((request) => <li key={request.id}><div><strong>{request.requestType === 'public_report' ? 'Melding van een bezoeker' : request.requestType === 'source_review' ? 'Bron vraagt beoordeling' : 'Onvolledige kandidaat'}</strong><p>{request.reason}</p><small>{date(request.createdAt)}</small></div><div><button className="secondary" onClick={() => void resolveRequest(request, 'resolved')} disabled={Boolean(busy)}>{busy === `request:${request.id}` ? 'Opslaan…' : 'Afgehandeld'}</button><button className="text-button" onClick={() => void resolveRequest(request, 'dismissed')} disabled={Boolean(busy)}>Niet overnemen</button></div></li>)}</ul>}</section>
  </section>;
}
