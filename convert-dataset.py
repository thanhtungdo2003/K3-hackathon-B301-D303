import pandas as pd
import json

# Đọc CSV
df = pd.read_csv("Batch03-K4-AI-Product-Hackathon/data/vlearn-pack/chatlog/chat_history_anonymized_for_hackathon.csv")

# Sắp xếp để đảm bảo đúng thứ tự
df = df.sort_values(
    ["conversation_id", "turn_id", "message_created_at", "message_id"]
)

# Chỉ giữ student và tutor
df = df[df["role"].isin(["student", "tutor"])]

# Mapping role
ROLE_MAP = {
    "student": "user",
    "tutor": "model"
}

with open("train.jsonl", "w", encoding="utf-8") as f:

    # Gom theo conversation + turn
    for (_, _), group in df.groupby(["conversation_id", "turn_id"]):

        contents = []

        for _, row in group.iterrows():
            text = str(row["content"]).strip()

            if text == "" or text.lower() == "nan":
                continue

            contents.append({
                "role": ROLE_MAP[row["role"]],
                "parts": [
                    {
                        "text": text
                    }
                ]
            })

        # Bỏ các sample không đủ user + model
        roles = [x["role"] for x in contents]
        if "user" not in roles or "model" not in roles:
            continue

        obj = {
            "contents": contents
        }

        f.write(json.dumps(obj, ensure_ascii=False) + "\n")

print("Done!")