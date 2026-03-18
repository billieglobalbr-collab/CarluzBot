const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'carluz.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS grupos (
    id TEXT PRIMARY KEY,
    ativo INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS usuarios (
    numero TEXT PRIMARY KEY,
    nome TEXT,
    saldo INTEGER DEFAULT 100,
    diario_ultimo TEXT DEFAULT '',
    presos INTEGER DEFAULT 0,
    expulsoes INTEGER DEFAULT 0,
    criado_em TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS inventario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT,
    item TEXT,
    comprado_em TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS votos_kick (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grupo TEXT,
    alvo TEXT,
    votante TEXT,
    criado_em TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS presos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grupo TEXT,
    numero TEXT,
    jid TEXT,
    solto_em TEXT,
    criado_em TEXT DEFAULT (datetime('now'))
  );
`);

function grupoAtivo(id) {
  const r = db.prepare('SELECT ativo FROM grupos WHERE id=?').get(id);
  return r && r.ativo === 1;
}
function ativarGrupo(id) {
  db.prepare('INSERT INTO grupos (id, ativo) VALUES (?,1) ON CONFLICT(id) DO UPDATE SET ativo=1').run(id);
}
function desativarGrupo(id) {
  db.prepare('UPDATE grupos SET ativo=0 WHERE id=?').run(id);
}
function getUsuario(numero, nome) {
  let u = db.prepare('SELECT * FROM usuarios WHERE numero=?').get(numero);
  if (!u) { db.prepare('INSERT INTO usuarios (numero, nome) VALUES (?,?)').run(numero, nome || numero); u = db.prepare('SELECT * FROM usuarios WHERE numero=?').get(numero); }
  if (nome && u.nome !== nome) db.prepare('UPDATE usuarios SET nome=? WHERE numero=?').run(nome, numero);
  return u;
}
function atualizarSaldo(numero, delta) {
  getUsuario(numero);
  db.prepare('UPDATE usuarios SET saldo=MAX(0,saldo+?) WHERE numero=?').run(delta, numero);
  return db.prepare('SELECT saldo FROM usuarios WHERE numero=?').get(numero).saldo;
}
function coletarDiario(numero, nome) {
  const u = getUsuario(numero, nome);
  const hoje = new Date().toISOString().slice(0, 10);
  if (u.diario_ultimo === hoje) return { sucesso: false, saldo: u.saldo };
  db.prepare('UPDATE usuarios SET saldo=saldo+75, diario_ultimo=? WHERE numero=?').run(hoje, numero);
  return { sucesso: true, saldo: db.prepare('SELECT saldo FROM usuarios WHERE numero=?').get(numero).saldo };
}
function getRanking(limite) {
  return db.prepare('SELECT numero, nome, saldo FROM usuarios ORDER BY saldo DESC LIMIT ?').all(limite || 10);
}
function getInventario(numero) {
  return db.prepare('SELECT item FROM inventario WHERE numero=?').all(numero);
}
function addInventario(numero, item) {
  db.prepare('INSERT INTO inventario (numero, item) VALUES (?,?)').run(numero, item);
}
function temItem(numero, item) {
  return !!db.prepare('SELECT id FROM inventario WHERE numero=? AND item=?').get(numero, item);
}
function transferir(de, para, valor) {
  const u = getUsuario(de);
  if (u.saldo < valor || valor <= 0) return false;
  getUsuario(para);
  db.prepare('UPDATE usuarios SET saldo=saldo-? WHERE numero=?').run(valor, de);
  db.prepare('UPDATE usuarios SET saldo=saldo+? WHERE numero=?').run(valor, para);
  return true;
}
// Votos kick
function addVoto(grupo, alvo, votante) {
  const jaVotou = db.prepare('SELECT id FROM votos_kick WHERE grupo=? AND alvo=? AND votante=?').get(grupo, alvo, votante);
  if (jaVotou) return false;
  db.prepare('INSERT INTO votos_kick (grupo, alvo, votante) VALUES (?,?,?)').run(grupo, alvo, votante);
  return true;
}
function getVotos(grupo, alvo) {
  return db.prepare('SELECT COUNT(*) as total FROM votos_kick WHERE grupo=? AND alvo=?').get(grupo, alvo).total;
}
function limparVotos(grupo, alvo) {
  db.prepare('DELETE FROM votos_kick WHERE grupo=? AND alvo=?').run(grupo, alvo);
}
// Presos
function prender(grupo, numero, jid, minutos) {
  const solto = new Date(Date.now() + minutos * 60000).toISOString();
  db.prepare('INSERT INTO presos (grupo, numero, jid, solto_em) VALUES (?,?,?,?)').run(grupo, numero, jid, solto);
  db.prepare('UPDATE usuarios SET presos=presos+1 WHERE numero=?').run(numero);
}
function estaPreso(grupo, jid) {
  const r = db.prepare('SELECT * FROM presos WHERE grupo=? AND jid=? ORDER BY id DESC LIMIT 1').get(grupo, jid);
  if (!r) return false;
  if (new Date(r.solto_em) > new Date()) return true;
  db.prepare('DELETE FROM presos WHERE id=?').run(r.id);
  return false;
}
function soltar(grupo, jid) {
  db.prepare('DELETE FROM presos WHERE grupo=? AND jid=?').run(grupo, jid);
}

module.exports = {
  grupoAtivo, ativarGrupo, desativarGrupo,
  getUsuario, atualizarSaldo, coletarDiario, getRanking,
  getInventario, addInventario, temItem, transferir,
  addVoto, getVotos, limparVotos,
  prender, estaPreso, soltar
};
