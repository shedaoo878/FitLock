try {
  const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjEyMyIsIm1ldGEiOiJzb21lX3ZhbHVlLXdpdGgtZGFzaGVzIn0.dummy";
  const payloadStr = token.split(".")[1];
  console.log("Payload:", payloadStr);
  const jsonStr = atob(payloadStr);
  console.log("Decoded:", jsonStr);
} catch (e) {
  console.error("Error:", e.message);
}
