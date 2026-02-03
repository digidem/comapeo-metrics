export function processDlq(batch: MessageBatch): void {
  for (const msg of batch.messages) {
    console.error({
      level: "error",
      message: "DLQ: message permanently failed",
      queue: batch.queue,
      messageId: msg.id,
      body: msg.body,
    });
    msg.ack();
  }
}
