FROM python:3.11-alpine

# Node.js is required by yt-dlp to evaluate YouTube's N-signatures
RUN apk add --no-cache nodejs

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Ensure we get the latest yt-dlp since YouTube changes frequently
RUN pip install --no-cache-dir -U yt-dlp

COPY main.py .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
