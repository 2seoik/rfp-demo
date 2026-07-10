import { NextResponse } from "next/server";

export async function GET() {
  try {
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({
      baseURL: process.env.LLM_API_BASE,
      apiKey: process.env.LLM_API_KEY,
    });

    // mimo-v2.5 with enough tokens for reasoning + output
    const response = await client.chat.completions.create({
      model: "mimo-v2.5",
      messages: [{ role: "user", content: "Say hello in Korean. One short sentence." }],
      max_tokens: 2048, // Enough for reasoning + output
    });

    const content = response.choices[0]?.message?.content || "(empty)";
    const usage = response.usage;
    
    return NextResponse.json({
      success: true,
      content,
      reasoning: usage?.completion_tokens_details?.reasoning_tokens,
      totalCompletion: usage?.completion_tokens,
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
    });
  }
}
