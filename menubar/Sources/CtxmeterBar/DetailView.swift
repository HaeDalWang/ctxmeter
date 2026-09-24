import CtxmeterBarCore
import SwiftUI

enum DetailWindowID {
    static let value = "ctxmeter-detail"
}

struct DetailView: View {
    let store: TelemetryStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("세션 컨텍스트 상세").font(.title3.weight(.semibold))
                    Text(store.workspace).font(.system(size: 11)).foregroundStyle(.secondary)
                }

                ForEach(Harness.allCases, id: \.self) { harness in
                    HarnessDetail(harness: harness, entry: store.report?.entry(harness))
                        .padding(12)
                        .background(.quaternary.opacity(0.25), in: RoundedRectangle(cornerRadius: 10))
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("측정 한계").font(.system(size: 11, weight: .semibold))
                    Text(limitsText)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 2)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minWidth: 480, minHeight: 500)
    }

    private var limitsText: String {
        """
        Claude와 Codex의 점유율은 관측된 입력 토큰을 알려진 컨텍스트 창으로 나눈 값이고, \
        Kiro는 세션이 직접 기록한 백분율입니다. 프로파일에 없는 모델은 용량을 추측하지 않고 \
        미확인으로 둡니다. 아이콘은 이 Mac에 설치된 각 벤더 앱에서 읽어옵니다. \
        설정 항목별 비용과 스킬 인벤토리는 npm run dashboard 쪽에서 확인하세요.
        """
    }
}
