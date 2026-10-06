FROM python:3.13-slim

WORKDIR /srv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# libgomp1: LightGBM; libgl1 / libglib2.0-0: OpenCV, used by the on-device OCR for report reading
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# What gets copied is controlled by .dockerignore.
COPY . .

EXPOSE 8000
# Hosts like Render and Cloud Run set $PORT; locally it is 8000.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
