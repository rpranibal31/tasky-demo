# Cómo borrar todo después de la entrevista

⚠️ **Importante**: Cloud SQL cobra por hora mientras la instancia exista, incluso sin tráfico.
Cloud Run no cobra si nadie lo llama (escala a cero), pero la DB sí. Borrá todo apenas termines.

## Opción recomendada: borrar el proyecto completo

Elimina de una vez Cloud Run, Cloud SQL, Artifact Registry, builds y logs. Es lo más seguro:
no queda nada suelto cobrando.

```powershell
gcloud projects delete tasky-demo-3938
```

El proyecto queda 30 días en estado "pendiente de eliminación" (recuperable con
`gcloud projects undelete tasky-demo-3938`) y deja de facturar de inmediato.

## Opción granular (si querés conservar el proyecto)

```powershell
# 1. Borrar el servicio de Cloud Run
gcloud run services delete tasky-api --region=us-central1 --project=tasky-demo-3938 --quiet

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
