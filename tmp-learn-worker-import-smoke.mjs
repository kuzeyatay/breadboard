const { getLearnStatusSnapshot } = await import("./dashboard/src/lib/learn.ts");
const snapshot = getLearnStatusSnapshot({
  gardenId: "electromagnetism-1",
  contentPath: "C:/Users/20252082/breadboard/quartz/content",
});
console.log(JSON.stringify({ status: snapshot.job?.status ?? null, jobId: snapshot.job?.id ?? null }));
