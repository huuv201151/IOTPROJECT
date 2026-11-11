# Theo dõi và cảnh báo mưa RainSense

Trang **Phân tích lượng mưa** hiển thị lượng tích lũy và tốc độ trung bình trong 15 phút, 1 giờ, 3 giờ và 24 giờ của trạm đang chọn. Cùng trang có diễn biến khí áp 3 giờ, ước tính lượng mưa 60 phút tới và trạng thái cảnh báo quan trắc.

Trong **Cảnh báo & Sự kiện**, quản trị viên có thể bật quy tắc **Lượng mưa tích lũy 60 phút**, nhập ngưỡng theo mm và chọn mức độ. Quy tắc cường độ hiện có dùng mm/h trung bình trong 5 phút. Backend kiểm tra mỗi 5 phút, chỉ lưu và gửi sự kiện khi vượt ngưỡng lần đầu hoặc mức độ tăng. Một giờ khô có đủ dữ liệu sẽ đặt lại trạng thái cho đợt sau.

Cảnh báo tự động dựa trên số đo đạt điều kiện chất lượng của trạm. Phần mềm kiểm tra thời gian sự kiện, độ phủ bản tin và các khoảng thử nước. Dữ liệu mô phỏng có nhãn riêng. Cảnh báo quan trắc lưu cửa sổ đo, ngưỡng, nguồn và phiên bản quy tắc trong lịch sử. Người dùng có thể mở **Xem mô phỏng** để thử với 16 mm trong 60 phút và ngưỡng 15 mm. Kịch bản chỉ đọc và không tạo cảnh báo thật.

## Đánh giá mô hình dự báo

Khi chưa có mô hình đạt kiểm định, ước tính lấy lượng đo trong 15 phút nhân 4 nếu cửa sổ đủ dữ liệu và có ghi nhận mưa. Ví dụ 3,2 mm trong 15 phút cho ước tính 12,8 mm trong 60 phút nếu cường độ duy trì. Phần ước tính không phát cảnh báo tự động.

Xuất dữ liệu theo trạm từ API RainSense. Thay mốc UTC bằng khoảng lịch sử cần đánh giá. Mỗi lần xuất hỗ trợ tối đa 31 ngày.

```powershell
npm run ai:train:rain --workspace=backend -- --export https://rainsense-backend-dlxg.onrender.com RS-ESP32S3-01 2026-11-01T00:00:00Z 2026-11-10T00:00:00Z observations.json
npm run ai:train:rain --workspace=backend -- observations.json rain-evaluation.json
```

Script so sánh Ridge dùng lượng mưa, Ridge dùng thêm khí áp và ước tính cường độ duy trì. Cả ba dùng cùng các tập thời gian, giữ mỗi đợt mưa trong một tập và chừa khoảng cách giữa các tập. Báo cáo ghi sai số trên toàn bộ mẫu và riêng các mẫu có mưa. Chỉ đặt biến `RAIN_MODEL_FILE` thành đường dẫn tới tệp báo cáo có `evaluated: true` trên backend. Mô hình áp dụng cho đúng trạm trong tệp và chỉ được dùng khi các đầu vào cần thiết đạt chất lượng.
