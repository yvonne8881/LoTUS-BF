#!/usr/bin/env python3
import sys
from sqlalchemy import create_engine, text

# Render 外部連線網址
DB_URL = "postgresql+psycopg2://lotus_bf_user:Vso8eC73WzRDluyYUsWEjmLZfkHjNXfC@dpg-dbovoldg1s2s738fg9dg-a.oregon-postgres.render.com/lotus_bf"

def main():
    print("🔌 連線至 Render PostgreSQL 資料庫...")
    engine = create_engine(DB_URL, pool_pre_ping=True)
    schema = "ns"

    print("1️⃣ 重建 ns.annotations_json 資料表結構...")
    with engine.begin() as conn:
        conn.execute(text(f"DROP TABLE IF EXISTS {schema}.annotations_json CASCADE;"))
        conn.execute(text(f"""
            CREATE TABLE {schema}.annotations_json (
                study_id    TEXT NOT NULL,
                contrast_id TEXT,
                terms       JSONB NOT NULL
            );
        """))

    print("2️⃣ 讀取全部文獻 ID 清單...")
    with engine.begin() as conn:
        rows = conn.execute(text(f"SELECT DISTINCT study_id FROM {schema}.annotations_terms;")).fetchall()
        studies = [r[0] for r in rows]

    total = len(studies)
    batch_size = 500
    print(f"共發現 {total:,} 個 study_id，將分為 {(total + batch_size - 1) // batch_size} 批次進行寫入...")

    for i in range(0, total, batch_size):
        batch = studies[i:i + batch_size]
        with engine.begin() as conn:
            conn.execute(text("SET LOCAL work_mem = '32MB';"))
            conn.execute(text(f"""
                INSERT INTO {schema}.annotations_json (study_id, contrast_id, terms)
                SELECT study_id, contrast_id, jsonb_object_agg(term, weight)
                FROM {schema}.annotations_terms
                WHERE study_id = ANY(:batch)
                GROUP BY study_id, contrast_id;
            """), {"batch": batch})
        done = min(i + batch_size, total)
        print(f"  └─ 進度: {done:,} / {total:,} ({done / total * 100:.1f}%)")

    print("3️⃣ 建立 GIN 快速檢索索引...")
    with engine.begin() as conn:
        conn.execute(text("SET LOCAL maintenance_work_mem = '64MB';"))
        conn.execute(text(f"CREATE INDEX IF NOT EXISTS idx_annotations_json_terms_gin ON {schema}.annotations_json USING GIN (terms);"))
        conn.execute(text(f"ANALYZE {schema}.annotations_json;"))

    print("處理完成")

if __name__ == "__main__":
    main()