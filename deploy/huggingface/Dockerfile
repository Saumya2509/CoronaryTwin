# CoronaryTwin API on a Hugging Face Space (Docker SDK). This file and README.md are the whole Space:
# the code is cloned from GitHub at build time, so the Space stays in sync with the repository.
# To pick up new GitHub commits: Space settings -> "Factory rebuild".
FROM python:3.13-slim

# git: clone the repo · libgomp1: LightGBM · libgl1 / libglib2.0-0: OpenCV (on-device OCR for report reading)
RUN apt-get update && apt-get install -y --no-install-recommends git libgomp1 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Spaces run the container as user 1000.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH PYTHONUNBUFFERED=1 \
    CORONARYTWIN_DB=/tmp/coronarytwin.db MPLCONFIGDIR=/tmp/matplotlib NUMBA_CACHE_DIR=/tmp/numba
WORKDIR /home/user/app

ARG REPO=https://github.com/Saumya2509/CoronaryTwin.git
ARG REF=main
RUN git clone --depth 1 --branch "$REF" "$REPO" . \
    && pip install --no-cache-dir --user -r requirements.txt

# Allowed website(s): set CORONARYTWIN_CORS_ORIGINS in the Space settings (Variables), e.g. https://your-app.vercel.app
EXPOSE 7860
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 7860"]
