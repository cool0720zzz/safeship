# FAKE fixture — 모든 키는 가짜 값
from flask import Flask, request
from openai import OpenAI

app = Flask(__name__)
client = OpenAI(api_key="YOUR_OPENAI_KEY")  # 데모: 하드코딩 대신 환경변수를 써야 함


@app.route("/ask")
def ask():
    q = request.args.get("q", "")
    r = client.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": q}])
    return r.choices[0].message.content


if __name__ == "__main__":
    app.run(debug=True)
