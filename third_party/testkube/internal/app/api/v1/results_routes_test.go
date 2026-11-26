package v1

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kubeshop/testkube/pkg/server"
)

func TestResultsRouteCompatibility(t *testing.T) {
	s := &TestkubeAPI{HTTPServer: server.NewServer(server.Config{})}
	s.InitRoutes()
	for _, endpoint := range []string{"/v1/info", "/results/v1/info"} {
		response, err := s.Mux.Test(httptest.NewRequest(http.MethodGet, endpoint, nil))
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != http.StatusOK || len(body) == 0 {
			t.Fatalf("%s: status %d, read error %v", endpoint, response.StatusCode, err)
		}
		// CLI ingress authentication still applies to both API prefixes.
		request := httptest.NewRequest(http.MethodGet, endpoint, nil)
		request.Header.Set(cliIngressHeader, "true")
		response, err = s.Mux.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s: expected unauthorized, got %d", endpoint, response.StatusCode)
		}
	}
	for _, endpoint := range []string{"/health", "/results/health"} {
		response, err := s.Mux.Test(httptest.NewRequest(http.MethodGet, endpoint, nil))
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("%s: status %d", endpoint, response.StatusCode)
		}
	}
}
