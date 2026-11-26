package containerexecutor

import (
	"context"
	"testing"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
)

func TestConfirmJobDeadline(t *testing.T) {
	controller := true
	pod := corev1.Pod{ObjectMeta: metav1.ObjectMeta{OwnerReferences: []metav1.OwnerReference{{Kind: "Job", Name: "execution", UID: types.UID("original"), Controller: &controller}}}}
	for _, tc := range []struct {
		name string
		uid types.UID
		condition batchv1.JobCondition
		want bool
	}{
		{"deadline", "original", batchv1.JobCondition{Type: batchv1.JobFailed, Status: corev1.ConditionTrue, Reason: "DeadlineExceeded"}, true},
		{"ordinary failure", "original", batchv1.JobCondition{Type: batchv1.JobFailed, Status: corev1.ConditionTrue, Reason: "BackoffLimitExceeded"}, false},
		{"success", "original", batchv1.JobCondition{Type: batchv1.JobComplete, Status: corev1.ConditionTrue}, false},
		{"wrong Job UID", "replacement", batchv1.JobCondition{Type: batchv1.JobFailed, Status: corev1.ConditionTrue, Reason: "DeadlineExceeded"}, false},
		{"unconfirmed", "original", batchv1.JobCondition{Type: batchv1.JobFailed, Status: corev1.ConditionFalse, Reason: "DeadlineExceeded"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			job := &batchv1.Job{ObjectMeta: metav1.ObjectMeta{Name: "execution", Namespace: "default", UID: tc.uid}, Status: batchv1.JobStatus{Conditions: []batchv1.JobCondition{tc.condition}}}
			c := ContainerExecutor{clientSet: fake.NewSimpleClientset(job), namespace: "default"}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if got := c.confirmJobDeadline(ctx, "execution", pod); got != tc.want {
				t.Fatalf("deadline = %v, want %v", got, tc.want)
			}
		})
	}
}
