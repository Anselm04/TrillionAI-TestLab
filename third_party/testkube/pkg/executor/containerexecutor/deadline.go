package containerexecutor

import (
	"context"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/wait"
)

// confirmJobDeadline binds the authoritative terminal Job condition to the
// original executor Pod. A failed Pod can appear before the Job controller
// publishes its terminal condition, so wait briefly for reconciliation.
func (c *ContainerExecutor) confirmJobDeadline(ctx context.Context, executionID string, pod corev1.Pod) bool {
	owner := metav1.GetControllerOf(&pod)
	if owner == nil || owner.Kind != "Job" || owner.Name != executionID || owner.UID == "" {
		return false
	}
	confirmed := false
	_ = wait.PollUntilContextTimeout(ctx, 200*time.Millisecond, 10*time.Second, true, func(ctx context.Context) (bool, error) {
		job, err := c.clientSet.BatchV1().Jobs(c.namespace).Get(ctx, executionID, metav1.GetOptions{})
		if err != nil {
			return false, err
		}
		if job.UID != owner.UID {
			return true, nil
		}
		for _, condition := range job.Status.Conditions {
			if condition.Status != corev1.ConditionTrue {
				continue
			}
			if condition.Type == batchv1.JobFailed {
				confirmed = condition.Reason == "DeadlineExceeded"
				return true, nil
			}
			if condition.Type == batchv1.JobComplete {
				return true, nil
			}
		}
		return false, nil
	})
	return confirmed
}
