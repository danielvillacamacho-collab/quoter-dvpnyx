const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const useSsl = ['true', '1', 'yes'].includes(String(process.env.DB_SSL || '').toLowerCase());

const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: useSsl ? { rejectUnauthorized: false } : false
});

const seed = async () => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const hash = await bcrypt.hash('000000', 12);
    await client.query(`
      INSERT INTO users (email, password_hash, name, role, must_change_password)
      VALUES ('daniel@doublevpartners.com', $1, 'Daniel Villa Camacho', 'superadmin', true)
      ON CONFLICT (email) DO NOTHING
    `, [hash]);

    const params = [
      ['level','L1',863,'Junior - Practicante / Aprendiz','Costo empresa USD/mes',1],
      ['level','L2',1207,'Junior - Guía constante','',2],
      ['level','L3',1797,'Junior - Autónomo tareas simples','',3],
      ['level','L4',2388,'Semi Senior - Supervisión mínima','',4],
      ['level','L5',3148,'Semi Senior - Complejidad media','',5],
      ['level','L6',3907,'Semi Senior - Lidera, mentora','',6],
      ['level','L7',4666,'Senior - Decisiones técnicas','',7],
      ['level','L8',5426,'Senior - Referente del equipo','',8],
      ['level','L9',6185,'Senior - Arquitecto / Lead','',9],
      ['level','L10',7071,'Líder / Crack - Especialista nicho','',10],
      ['level','L11',7957,'Líder / Crack - Thought leader','',11],
      ['geo','Colombia',1.00,'Pivote base','',1],
      ['geo','Ecuador',1.10,'Ajustado por CPO','',2],
      ['geo','Centroamérica',1.10,'Sin Panamá ni CR','',3],
      ['geo','Panamá',1.30,'Dolarizado','',4],
      ['geo','Costa Rica',1.45,'Mercado tech maduro','',5],
      ['geo','México',1.30,'Nearshore competitivo','',6],
      ['geo','Estados Unidos',3.00,'Contratación en suelo US','',7],
      ['bilingual','No',1.00,'Solo español','',1],
      ['bilingual','Sí',1.10,'Bilingüe (inglés)','',2],
      ['tools','Sin herramientas',0,'Cliente provee todo','',1],
      ['tools','Básico',185,'Laptop, pantalla, silla, correo, licencias','',2],
      ['tools','Premium',350,'Laptop alto rendimiento, celular, licencias AI','',3],
      ['stack','Estándar',0.90,'Alto volumen de talento','',1],
      ['stack','Especializada',1.00,'Experiencia comprobada','',2],
      ['stack','Alta Demanda / Nicho',1.20,'Escasez de talento','',3],
      ['modality','Remoto',0.95,'Sin costos de oficina','',1],
      ['modality','Híbrido',1.10,'Costos parciales','',2],
      ['modality','100% Presencial',1.20,'Puesto fijo, servicios','',3],
      ['margin','talent',0.35,'Margen talento','Sobre componente salarial',1],
      ['margin','tools',0.00,'Margen herramientas','Pass-through',2],
      ['project','buffer',0.10,'Buffer de error','1%-10%',1],
      ['project','warranty',0.05,'Garantía y soporte','1%-5%',2],
      ['project','min_margin',0.50,'Margen mínimo','PM no cotizado',3],
      ['project','hours_month',160,'Horas/mes','Base cálculo',4],
    ];
    for (const [cat, key, val, label, note, sort] of params) {
      await client.query(`
        INSERT INTO parameters (category, key, value, label, note, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (category, key) DO UPDATE SET value=$3, label=$4, note=$5
      `, [cat, key, val, label, note, sort]);
    }
    await client.query('COMMIT');
    console.log('Seed completed: admin user + parameters loaded');
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
};
seed().catch(() => process.exit(1));
