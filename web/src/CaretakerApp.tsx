import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, HeartHandshake, ShieldCheck } from 'lucide-react';
import { api } from './api';

interface CaretakerLocation {
  id: string;
  title: string;
  addressLine: string;
  postalCode: string;
  city: string;
  status: 'active' | 'inactive';
  categories: string[];
  lastVerifiedAt: string;
}

function caretakerToken(): string {
  return decodeURIComponent(window.location.pathname.split('/').filter(Boolean).at(-1) ?? '');
}

export function CaretakerApp() {
  const token = caretakerToken();
  const [location, setLocation] = useState<CaretakerLocation>();
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.request<CaretakerLocation>(`/api/public/caretaker/${encodeURIComponent(token)}`)
      .then((value) => { setLocation(value); setTitle(value.title); setAddress(value.addressLine); setPostalCode(value.postalCode); setCity(value.city); setStatus(value.status); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Deze beheerlink is niet beschikbaar.'))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError('');
    setSaved(false);
    try {
      const updated = await api.request<CaretakerLocation>(`/api/public/caretaker/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: JSON.stringify({ title, address, postalCode, city, status, categories: location?.categories ?? [] }),
      });
      setLocation(updated);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'De wijziging kon niet worden opgeslagen.');
    }
  }

  return <main className="caretaker-page"><header className="caretaker-header"><a className="resident-brand" href="/"><span><HeartHandshake /></span><strong>Weggeefkastje.nl</strong></a></header><section className="caretaker-card">{loading ? <p>Beheerlink controleren…</p> : !location ? <><h1>Deze beheerlink is niet beschikbaar</h1><p className="muted">De link is mogelijk verlopen of ingetrokken.</p><a className="secondary" href="/">Naar de bewonersvinder</a></> : <><p className="eyebrow">JOUW KASTJE BIJWERKEN</p><h1>Houd je kastje actueel</h1><p className="muted">Alleen een volledig, gecontroleerd adres kan zichtbaar zijn voor buurtbewoners.</p><form onSubmit={submit}><label>Naam van het kastje<input value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={160} required /></label><label>Straat en huisnummer<input value={address} onChange={(event) => setAddress(event.target.value)} minLength={5} maxLength={240} required /></label><div className="form-grid"><label>Postcode<input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} required /></label><label>Plaats<input value={city} onChange={(event) => setCity(event.target.value)} required /></label></div><label>Staat het kastje er nu?<select value={status} onChange={(event) => setStatus(event.target.value as 'active' | 'inactive')}><option value="active">Ja, zichtbaar voor buurtbewoners</option><option value="inactive">Nee, tijdelijk niet zichtbaar</option></select></label>{error && <p className="form-error" role="alert">{error}</p>}{saved && <p className="resident-success" role="status"><CheckCircle2 aria-hidden="true" />Je wijziging is opgeslagen.</p>}<button className="primary" type="submit">Gegevens opslaan</button></form><p className="caretaker-note"><ShieldCheck aria-hidden="true" />Deze persoonlijke link geldt alleen voor dit kastje.</p></>}</section></main>;
}
