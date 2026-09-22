# Cómo borrar todo después de la entrevista

⚠️ **Importante**: Cloud SQL cobra por hora mientras la instancia exista, incluso sin tráfico.
Cloud Run no cobra si nadie lo llama (escala a cero), **salvo que tenga `min-instances`**, que es
justamente lo que se activa antes de la demo para evitar el arranque en frío.

Costo aproximado mientras siga arriba: **~$0.40–0.60 USD por día**, descontados del crédito de $300
de la prueba gratuita. No sale de la tarjeta mientras quede crédito.

## Paso 1 — Apagar min-instances (después de la demo)

Esto por sí solo corta la mayor parte del costo de Cloud Run y deja los links funcionando.

```powershell
gcloud run services update tasky-api --min-instances=0 --region=us-central1 --project=tasky-demo-3938
gcloud run services update tasky-web --min-instances=0 --region=us-central1 --project=tasky-demo-3938
```

## Paso 2 — Borrar todo (cuando ya no necesites los links)

Elimina de una vez Cloud Run, Cloud SQL, Artifact Registry, builds y logs. Es lo más seguro:
no queda nada suelto cobrando.

```powershell
gcloud projects delete tasky-demo-3938
```

El proyecto queda 30 días en estado "pendiente de eliminación" (recuperable con
`gcloud projects undelete tasky-demo-3938`) y deja de facturar de inmediato.

> Ojo: al borrar el proyecto, las URLs públicas dejan de funcionar. Si le pasaste los links al
> entrevistador, avisale antes o esperá a que ya no los necesiten.

## Alternativa granular (si querés conservar el proyecto)

```powershell
# 1. Borrar los servicios de Cloud Run
gcloud run services delete tasky-api --region=us-central1 --project=tasky-demo-3938 --quiet
gcloud run services delete tasky-web --region=us-central1 --project=tasky-demo-3938 --quiet

# 2. Borrar la instancia de Cloud SQL  <-- esto es lo que más cobra
gcloud sql instances delete tasky-db --project=tasky-demo-3938 --quiet

# 3. Borrar las imágenes del build (Artifact Registry también cobra storage)
gcloud artifacts repositories delete cloud-run-source-deploy --location=us-central1 --project=tasky-demo-3938 --quiet
```

## Verificar que no quedó nada

```powershell
gcloud sql instances list --project=tasky-demo-3938
gcloud run services list --project=tasky-demo-3938
gcloud artifacts repositories list --project=tasky-demo-3938
```

Las tres deberían salir vacías.
