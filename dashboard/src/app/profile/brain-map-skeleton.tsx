import ThoughtTopologyLoadingDots from "@/app/components/thought-topology-loading-dots";

export default function BrainMapSkeleton() {
  return (
    <div className="profile-quartz-topology" aria-busy="true">
      <div className="thought-topology-meta">
        <div className="thought-topology-heading">
          <h2>Thought Topology</h2>
          <p>How the ideas in your gardens are organized and connected.</p>
        </div>
        <p className="profile-quartz-topology-refresh" role="status">
          Updating Thought Topology…
        </p>
      </div>
      <div className="graph-outer profile-quartz-topology-skeleton">
        <ThoughtTopologyLoadingDots />
      </div>
    </div>
  );
}
