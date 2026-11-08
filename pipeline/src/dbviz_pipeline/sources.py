"""Where monthly train-stop data comes from.

A source turns a month (``YYYY-MM``) into a local Parquet file with at least
``REQUIRED_COLUMNS``. To add a new source (another mirror, a live API collector,
...), write a class with the same fields and ``fetch`` and expose it in ``cli.make_source``;
nothing downstream changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar

REQUIRED_COLUMNS = (
    "eva", "train_type", "delay_in_min", "time",
    "arrival_is_canceled", "departure_is_canceled",
)
HUGGING_FACE_URL = "https://huggingface.co/datasets/piebro/deutsche-bahn-data"


@dataclass
class HuggingFaceSource:
    """Monthly files from piebro/deutsche-bahn-data (about 100 MB per month)."""

    raw_dir: Path
    url: str = HUGGING_FACE_URL
    repo_id: str = "piebro/deutsche-bahn-data"
    name: ClassVar[str] = "huggingface"
    # Downloads can be re-fetched, so they may be deleted after ingesting.
    disposable: ClassVar[bool] = True

    def fetch(self, month: str) -> Path:
        filename = f"monthly_processed_data/data-{month}.parquet"
        cached = self.raw_dir / filename
        if cached.is_file():
            return cached
        from huggingface_hub import hf_hub_download

        return Path(hf_hub_download(
            repo_id=self.repo_id, repo_type="dataset", filename=filename, local_dir=self.raw_dir,
        ))


@dataclass
class LocalParquetSource:
    """Parquet files you already have, e.g. from a teammate or another export."""

    directory: Path
    url: str = HUGGING_FACE_URL
    pattern: str = "data-{month}.parquet"
    name: ClassVar[str] = "local"
    disposable: ClassVar[bool] = False

    def fetch(self, month: str) -> Path:
        path = self.directory / self.pattern.format(month=month)
        if not path.is_file():
            raise FileNotFoundError(f"No local file for {month}: {path}")
        return path
