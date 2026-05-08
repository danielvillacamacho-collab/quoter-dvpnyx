import React, { useEffect, useState } from 'react';
import { apiGet, apiPut } from '../utils/apiV2';

const s = {
  page:  { maxWidth: 680 },
  card:  { background: 'var(--ds-surface)', borderRadius: 12, border: '1px solid var(--ds-border)', padding: 28, marginBottom: 20 },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--ds-text-dim)', marginBottom: 4, display: 'block' },
  input: { width: '100%', padding: '9px 12px', border: '1px solid var(--ds-border)', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-mono, monospace)', background: 'var(--ds-surface)' },
  row:   { marginBottom: 18 },
  btn:   { background: 'var(--ds-accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnGhost: { background: 'transparent', color: 'var(--ds-text)', border: '1px solid var(--ds-border)', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  toggleRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  hint:  { fontSize: 11.5, color: 'var(--ds-text-muted)', marginTop: 4 },
  ok:    { color: '#2e7d32', fontSize: 13, fontWeight: 600 },
  err:   { color: '#c62828', fontSize: 13, fontWeight: 600 },
  divider: { border: 'none', borderTop: '1px solid var(--ds-border)', margin: '20px 0' },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: 'var(--ds-text)', marginBottom: 14 },
};

const REGION_OPTIONS = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'sa-east-1', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-northeast-1'];

export default function AwsSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  const [snsEnabled, setSnsEnabled] = useState(false);
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [secretPlaceholder, setSecretPlaceholder] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [topicArn, setTopicArn] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { data } = await apiGet('/api/admin/settings');
        setSnsEnabled(data.sns_enabled === 'true');
        setAccessKey(data.aws_access_key_id || '');
        setSecretPlaceholder(data.aws_secret_access_key || '');
        setRegion(data.aws_region || 'us-east-1');
        setTopicArn(data.sns_topic_arn || '');
      } catch (_e) { /* show empty form */ }
      finally { setLoading(false); }
    })();
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setSaveMsg(null);
    try {
      const payload = {
        sns_enabled:          String(snsEnabled),
        aws_access_key_id:    accessKey.trim(),
        aws_region:           region,
        sns_topic_arn:        topicArn.trim(),
      };
      // Only send secret if the user typed something new (i.e. it's not the redacted placeholder)
      if (secretKey && secretKey !== '••••••••') {
        payload.aws_secret_access_key = secretKey;
      }
      await apiPut('/api/admin/settings', payload);
      setSaveMsg({ ok: true, msg: 'Configuración guardada' });
      // Clear the secret field after save — next load will show placeholder again
      setSecretKey('');
      setSecretPlaceholder('••••••••');
    } catch (err) {
      setSaveMsg({ ok: false, msg: err.message || 'Error al guardar' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 40, color: 'var(--ds-text-muted)' }}>Cargando…</div>;

  return (
    <div style={s.page}>
      <div className="page-header">
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ds-text)', margin: 0 }}>Integración Amazon SNS</h1>
      </div>

      <form onSubmit={handleSave}>
        <div style={s.card}>
          <div style={s.sectionTitle}>Estado del servicio</div>
          <div style={s.toggleRow}>
            <input
              id="sns-enabled"
              type="checkbox"
              checked={snsEnabled}
              onChange={(e) => setSnsEnabled(e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            <label htmlFor="sns-enabled" style={{ fontSize: 13, cursor: 'pointer', color: 'var(--ds-text)' }}>
              Activar notificaciones por email vía Amazon SNS
            </label>
          </div>
          <p style={s.hint}>
            Cuando está activo, el botón "Enviar recordatorio" en las notificaciones publicará un mensaje
            al topic SNS configurado abajo. Los suscriptores del topic (correos registrados en AWS) recibirán el aviso.
          </p>
        </div>

        <div style={s.card}>
          <div style={s.sectionTitle}>Credenciales AWS</div>

          <div style={s.row}>
            <label style={s.label} htmlFor="aws-key-id">Access Key ID</label>
            <input
              id="aws-key-id"
              style={s.input}
              type="text"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              placeholder="AKIAIOSFODNN7EXAMPLE"
              autoComplete="off"
            />
          </div>

          <div style={s.row}>
            <label style={s.label} htmlFor="aws-secret">Secret Access Key</label>
            <input
              id="aws-secret"
              style={s.input}
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={secretPlaceholder || 'Ingresa la clave secreta'}
              autoComplete="new-password"
            />
            <div style={s.hint}>Deja en blanco para conservar la clave existente.</div>
          </div>

          <div style={s.row}>
            <label style={s.label} htmlFor="aws-region">Región</label>
            <select
              id="aws-region"
              style={{ ...s.input, fontFamily: 'var(--font-ui, inherit)' }}
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            >
              {REGION_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={s.card}>
          <div style={s.sectionTitle}>Topic SNS</div>

          <div style={s.row}>
            <label style={s.label} htmlFor="sns-topic-arn">Topic ARN</label>
            <input
              id="sns-topic-arn"
              style={s.input}
              type="text"
              value={topicArn}
              onChange={(e) => setTopicArn(e.target.value)}
              placeholder="arn:aws:sns:us-east-1:123456789012:dvpnyx-reminders"
            />
            <div style={s.hint}>
              Crea un topic en la consola de AWS SNS y añade suscripciones de tipo Email para cada persona
              que deba recibir los recordatorios. El ARN tiene el formato
              <code style={{ marginLeft: 4 }}>arn:aws:sns:&lt;región&gt;:&lt;cuenta&gt;:&lt;nombre-topic&gt;</code>.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button type="submit" style={s.btn} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar configuración'}
          </button>
          {saveMsg && (
            <span style={saveMsg.ok ? s.ok : s.err}>{saveMsg.msg}</span>
          )}
        </div>
      </form>
    </div>
  );
}
