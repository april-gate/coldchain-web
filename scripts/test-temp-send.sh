
curl -X POST http://localhost:8080/ingest \
  -H "Content-Type: application/json" \
  -d '{"shipment_id":"shipment-test-v1.0","proof_count":1,"device_id":"local-test-1","temp_c":4.2}'

curl -X POST http://localhost:8080/ingest \
  -H "Content-Type: application/json" \
  -d '{"shipment_id":"shipment-test-v1.0","proof_count":2,"device_id":"local-test-1","temp_c":4.5}'

curl -X POST http://localhost:8080/ingest \
  -H "Content-Type: application/json" \
  -d '{"shipment_id":"shipment-test-v1.0","proof_count":3,"device_id":"local-test-1","temp_c":3.9}'
