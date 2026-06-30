# Llevar CitaFlow a internet (VPS + Cloudflare Tunnel)

Los datos viven en **Supabase**, así que el servidor es *stateless*: no necesita
disco persistente. Solo corre el contenedor y ponle un túnel con HTTPS delante.

## 1. Lleva el código al VPS
Sin `.env`, sin `node_modules`, sin `data/` (esos van en `.dockerignore`).
Por ejemplo, desde tu PC:
```bash
rsync -av --exclude node_modules --exclude .env --exclude data \
  citaflow/  usuario@tu-vps:/opt/citaflow/
```
(o sube la carpeta por git y haz `git clone` en el VPS.)

## 2. Crea el .env EN el VPS (los secretos nunca salen de ahí)
```bash
cd /opt/citaflow
cat > .env <<EOF
PORT=4000
SUPABASE_URL=https://lvhjdtllasgtgefyufnq.supabase.co
SUPABASE_SERVICE_KEY=  # pega tu service_role key
GROQ_API_KEY=          # pega tu llave de Groq
AUTH_SECRET=$(openssl rand -hex 32)
SEED_DEMO=false
EOF
```
> `AUTH_SECRET` se genera solo con el comando de arriba. `SEED_DEMO=false` evita
> recrear la clínica de ejemplo en producción.

## 3. Build + run
```bash
docker build -t citaflow .
docker run -d --name citaflow --restart unless-stopped \
  -p 4000:4000 --env-file .env citaflow
```
Comprueba: `curl localhost:4000` → debe responder. El log debe decir
"IA: Groq conectado" y conectarse a Supabase sin error.

## 4. Cloudflare Tunnel (igual que tu n8n)
En tu túnel, agrega un public hostname nuevo, p. ej. `citas.tudominio.com`
→ apunta a `http://localhost:4000`. Listo: HTTPS automático.
Las cookies se vuelven `Secure` solas detrás de HTTPS (ya está en el código).

## 5. Actualizar / re-desplegar
```bash
cd /opt/citaflow && git pull   # o vuelve a rsync
docker build -t citaflow . && docker restart citaflow
```
(o `docker stop citaflow && docker rm citaflow` y vuelve a correr el `run`.)

---

## Pendiente para COBRAR (después del deploy)
1. **WhatsApp**: número de WhatsApp Business verificado + token permanente, y
   apuntar el webhook de Meta a `https://citas.tudominio.com/webhook/whatsapp`.
   Vincular el `whatsapp_phone_id` de cada negocio en su alta.
2. **Pagos**: el checkout de Culqi ya está integrado en el código (modal de
   Culqi.js en el dashboard, tokeniza la tarjeta antes de cobrar). Solo falta:
   abrir cuenta en [culqi.com](https://culqi.com), copiar `pk_live_...` y
   `sk_live_...`, y pegarlas como `CULQI_PUBLIC_KEY`/`CULQI_SECRET_KEY` (en
   Render: Environment del servicio; en VPS: el `.env`). Sin esas llaves, el
   botón "Mejorar a Pro" sigue en modo simulado — no cobra de verdad.

## Checklist pre-lanzamiento
- [ ] Secretos solo en `.env` del VPS (nunca en git ni en la imagen).
- [ ] `SEED_DEMO=false` en producción.
- [ ] Dominio + HTTPS por Cloudflare Tunnel.
- [ ] Datos en Supabase (✅ ya está) — considerar backups/PITR del proyecto.
- [ ] Revisar `privacy`/`terms` con asesoría legal.
