"""Single entrypoint for every role of the system.

The same container image runs as the API, the ingestor, the analyzer or the
migration job; Kubernetes picks the role through the container `args`.
"""

import argparse
import logging

from skypulse.config import settings


def main() -> None:
    parser = argparse.ArgumentParser(prog="skypulse")
    parser.add_argument("role", choices=["api", "ingestor", "analyzer", "migrate"])
    args = parser.parse_args()

    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # httpx logs every request at INFO; that drowns out our own messages.
    logging.getLogger("httpx").setLevel(logging.WARNING)

    if args.role == "api":
        import uvicorn

        uvicorn.run(
            "skypulse.api:app",
            host="0.0.0.0",
            port=settings.http_port,
            # Let Kubernetes probes and the ingress see real client info, keep logs quiet.
            proxy_headers=True,
            access_log=False,
        )
    elif args.role == "ingestor":
        from skypulse.ingestor import run

        run()
    elif args.role == "analyzer":
        from skypulse.analyzer import run

        run()
    elif args.role == "migrate":
        from skypulse.db import migrate

        migrate()


if __name__ == "__main__":
    main()
