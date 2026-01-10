---
description: how to run the rappio-server using Docker
---

To run the Rappio server using Docker, follow these steps:

1. **Ensure you have Docker and Docker Compose installed** on your system.

2. **Prepare your environment variables**:
   Make sure you have a `.env` file in the root directory. The Docker Compose file will use this.

// turbo
3. **Build and start the containers**:
   Run the following command in your terminal:
   ```bash
   docker compose up --build
   ```
   The `--build` flag ensures that the latest code changes (including the fixes I just implemented) are included in the new image.

4. **Verify the services**:
   - NestJS API: [http://localhost:8000](http://localhost:8000)
   - Media HTTP (HLS): `http://localhost:8001`
   - RTMP Server: `rtmp://localhost:1935/live`

5. **Stop the server**:
   To stop the server and remove the containers, run:
   ```bash
   docker compose down
   ```

> [!NOTE]
> The database will persist its data in a Docker volume named `pg_data`.
