import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store';
import { useTheme, withAlpha } from '../theme';
import {
  AppScreen,
  Card,
  Field,
  GhostButton,
  PrimaryButton,
  SectionTitle,
  TopBar,
} from '../ui';
import type { AppState } from '../types';
import { startLanImport } from '../net/lanServer';
import type { LanImportSession } from '../net/lanServer';
import { importFromJwxt } from '../net/jwxt';
import type { JwxtImportResult } from '../net/jwxt';

/**
 * 导入相关页面（三条入口，供 src/app/import-*.tsx 路由直接渲染）：
 *
 *  - ImportJwxtScreen     教务网直连导入（学号 / 密码 → importFromJwxt）
 *  - ImportJsonScreen     粘贴或选择 JSON 文件导入（expo-document-picker + expo-file-system）
 *  - ImportComputerScreen 电脑 / 手机扫码导入（src/net/lanServer 起本地 HTTP 服务 + 二维码）
 *
 * 约定：
 *  - 全部使用自绘 TopBar + `router.back()` 返回，不使用原生 Alert；
 *    成功 / 失败 / 加载状态都用页面内的卡片提示。
 *  - 数据写入统一走 `useStore()`：`replaceState`（完整 state）或 `importJson`（JSON 文本，
 *    由 core 归一化并保留手表端设置）。
 *  - 样式与 TodayScreen / CourseEditScreen 保持一致：暖灰绿纸面、鼠尾草绿主色、纯色无渐变。
 */

/* ------------------------------ 通用工具 ------------------------------ */

/** 单个课表 JSON 的大小上限（桌面端备份通常几十 KB；限制避免误贴超大文本卡住 JS 线程） */
const MAX_JSON_BYTES = 2 * 1024 * 1024;

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

type NoteKind = 'ok' | 'error' | 'info';

/** 页面内状态提示（替代原生 Alert） */
function Note({ kind, title, text }: { kind: NoteKind; title?: string; text: string }) {
  const { palette } = useTheme();
  const tint = kind === 'ok' ? palette.accentDeep : kind === 'error' ? palette.danger : palette.ink2;
  const background = kind === 'ok'
    ? withAlpha(palette.accent, palette.isDark ? 0.2 : 0.12)
    : kind === 'error'
      ? withAlpha(palette.danger, palette.isDark ? 0.2 : 0.1)
      : palette.paperDeep;
  const borderColor = kind === 'info'
    ? palette.line
    : withAlpha(kind === 'ok' ? palette.accent : palette.danger, 0.4);
  return (
    <View style={[styles.note, { backgroundColor: background, borderColor }]}>
      {title ? <Text style={[styles.noteTitle, { color: tint }]}>{title}</Text> : null}
      <Text style={{ color: kind === 'info' ? palette.ink2 : tint, fontSize: 12.5, lineHeight: 19 }}>{text}</Text>
    </View>
  );
}

/** 加载中提示行 */
function BusyRow({ text }: { text: string }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.busyRow, { borderColor: palette.line, backgroundColor: palette.surface }]}>
      <ActivityIndicator size="small" color={palette.accent} />
      <Text style={{ flex: 1, color: palette.ink3, fontSize: 12.5, lineHeight: 18 }}>{text}</Text>
    </View>
  );
}

/** 多行 JSON 输入框：关闭自动大写 / 自动纠错，避免破坏 JSON */
function JsonTextArea({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}) {
  const { palette } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={palette.ink4}
      multiline
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      textAlignVertical="top"
      style={[
        styles.jsonArea,
        { color: palette.ink, backgroundColor: palette.surface, borderColor: palette.line },
      ]}
    />
  );
}

/** 说明步骤行 */
function Step({ index, text }: { index: number; text: string }) {
  const { palette } = useTheme();
  return (
    <View style={styles.step}>
      <View style={[styles.stepNum, { backgroundColor: palette.accentSoft }]}>
        <Text style={{ color: palette.accentDeep, fontSize: 11, fontWeight: '600' }}>{index}</Text>
      </View>
      <Text style={{ flex: 1, color: palette.ink2, fontSize: 12.5, lineHeight: 19 }}>{text}</Text>
    </View>
  );
}

/* --------------------------- 教务网直连导入 --------------------------- */

/**
 * 兜底：src/net/jwxt.ts 正常路径都会返回 `{ ok:false, message }`（中文可直接展示），
 * 这里只处理意外抛出（例如原生模块缺失、网络层断言失败）时的错误文案。
 */
function unexpectedErrorMessage(error: any): string {
  const message = typeof error?.message === 'string' ? error.message : '';
  return message || '教务网导入失败，请检查网络后重试，或改用「粘贴 JSON」导入';
}

export function ImportJwxtScreen() {
  const router = useRouter();
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const { state, replaceState } = useStore();
  const settings = state.settings;

  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const canSubmit = !busy && studentId.trim().length > 0 && password.length > 0;

  const clearError = useCallback(() => {
    setPhase((prev) => (prev === 'error' ? 'idle' : prev));
    setMessage('');
  }, []);

  /**
   * 把 importFromJwxt 的结果写入 store：
   *  - 失败：直接抛错，由页面展示 message（中文，来自 JwxtError）；
   *  - 成功：state 已是与桌面端同构的完整 state，用 replaceState 写入，
   *    store 内部会保留本机 settings（主题、提醒等）。
   */
  const applyImportResult = useCallback(async (result: JwxtImportResult): Promise<string> => {
    if (!result.ok) throw new Error(result.message);
    const next: AppState = { ...(result.state as AppState), settings };
    if (!Array.isArray(next.courses) || next.courses.length === 0) {
      throw new Error('没有解析到课程，可能学期选择不对或该学期暂无课表');
    }
    await replaceState(next);
    const slots = next.courses.reduce(
      (total, course) => total + (Array.isArray(course.slots) ? course.slots.length : 0),
      0,
    );
    const floating = Array.isArray(next.floatingCourses) ? next.floatingCourses.length : 0;
    return `已导入 ${next.courses.length} 门课 / ${slots} 个时间片${floating > 0 ? ` / ${floating} 门网络课` : ''}`;
  }, [replaceState, settings]);

  const submit = useCallback(async () => {
    if (busy) return;
    const username = studentId.trim();
    if (!username) {
      setPhase('error');
      setMessage('请先填写学号');
      return;
    }
    if (!password) {
      setPhase('error');
      setMessage('请先填写密码');
      return;
    }
    setBusy(true);
    setPhase('idle');
    setMessage('');
    try {
      const result = await importFromJwxt(username, password, state);
      const text = await applyImportResult(result);
      setPassword('');
      setPhase('ok');
      setMessage(text);
    } catch (error: any) {
      setPhase('error');
      setMessage(unexpectedErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [applyImportResult, busy, password, studentId]);

  return (
    <AppScreen edges={['top']}>
      <TopBar title="教务网导入" subtitle="文华学院 · 正方教务" onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.intro, { color: palette.ink3 }]}>
            直接用教务系统账号登录并抓取本学期课表。账号密码只用于本次登录，不会保存在本机。
          </Text>

          <Card>
            <Field
              label="学号"
              value={studentId}
              onChangeText={(v) => { setStudentId(v); clearError(); }}
              placeholder="请输入教务系统学号"
              keyboardType="number-pad"
            />
            <Field
              label="密码"
              value={password}
              onChangeText={(v) => { setPassword(v); clearError(); }}
              placeholder="请输入教务系统密码"
              secureTextEntry
            />
            <Text style={[styles.hint, { color: palette.ink4 }]}>
              登录可能需要 10~30 秒；若学校开启了验证码、或提示密码错误，请改用「粘贴 JSON」导入。
            </Text>
          </Card>

          {busy ? <BusyRow text="正在登录教务网并抓取课表，请勿离开本页…" /> : null}
          {phase === 'error' ? <Note kind="error" title="导入失败" text={message} /> : null}
          {phase === 'ok' ? (
            <>
              <Note kind="ok" title="导入成功" text={`${message}。课表已保存，本机提醒会自动更新。`} />
              <PrimaryButton label="完成" onPress={() => router.back()} style={{ marginTop: 12 }} />
            </>
          ) : null}

          <Text style={[styles.footnote, { color: palette.ink4 }]}>
            教务网导入会覆盖固定课程；已有调休记录会保留。若失败，可随时改用其他导入方式。
          </Text>
        </ScrollView>

        <View
          style={[
            styles.bottomBar,
            {
              backgroundColor: palette.surface,
              borderTopColor: palette.line,
              paddingBottom: keyboardVisible ? 10 : Math.max(10, insets.bottom),
            },
          ]}
        >
          <GhostButton label="粘贴 JSON" onPress={() => router.push('/import-json')} style={styles.barBtn} />
          <View style={{ flex: 1 }} />
          <PrimaryButton
            label={busy ? '导入中…' : '登录并导入'}
            onPress={submit}
            disabled={!canSubmit}
            style={styles.barPrimary}
          />
        </View>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

/* ----------------------------- JSON 导入 ----------------------------- */

export function ImportJsonScreen() {
  const router = useRouter();
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const { state, importJson } = useStore();

  const [json, setJson] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const clearResult = useCallback(() => {
    setResult((prev) => (prev && prev.kind === 'error' ? null : prev));
  }, []);

  const pickFile = useCallback(async () => {
    if (busy || picking) return;
    setPicking(true);
    setResult(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset) return;
      if (typeof asset.size === 'number' && asset.size > MAX_JSON_BYTES) {
        throw new Error('文件超过 2 MB，请精简后再导入');
      }
      // SDK 54+ 的新 File API：直接读文件文本（picker 已复制到缓存目录）
      const text = await new File(asset.uri).text();
      if (!text.trim()) throw new Error('文件内容为空');
      setJson(text);
      setFileName(asset.name || '已选择文件');
    } catch (error: any) {
      const message = typeof error?.message === 'string' ? error.message : '';
      const own = message.startsWith('文件超过') || message.startsWith('文件内容');
      setResult({
        kind: 'error',
        text: own ? message : (message ? `读取文件失败：${message}` : '读取文件失败，请改用粘贴'),
      });
    } finally {
      setPicking(false);
    }
  }, [busy, picking]);

  const doImport = useCallback(async () => {
    if (busy) return;
    const text = json.trim();
    if (!text) {
      setResult({ kind: 'error', text: '请先选择 JSON 文件，或粘贴 JSON 内容' });
      return;
    }
    if (text.length > MAX_JSON_BYTES) {
      setResult({ kind: 'error', text: '内容超过 2 MB，请精简后再导入' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const imported = await importJson(text, 'json');
      setResult({ kind: imported.ok ? 'ok' : 'error', text: imported.message });
      if (imported.ok) {
        setFileName('');
      }
    } catch (error: any) {
      setResult({ kind: 'error', text: error?.message || '导入失败，请检查 JSON 格式' });
    } finally {
      setBusy(false);
    }
  }, [busy, importJson, json]);

  return (
    <AppScreen edges={['top']}>
      <TopBar title="导入 JSON" subtitle="从电脑端课序导出" onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.intro, { color: palette.ink3 }]}>
            在电脑端课序打开「设置 → 数据 → 导出 JSON 备份」，把生成的 .json 文件传到这里；也可以把内容直接粘贴到下方。
          </Text>

          <SectionTitle
            right={<Text style={{ color: palette.ink4, fontSize: 11 }}>当前 {state.courses.length} 门课</Text>}
          >
            选择文件
          </SectionTitle>
          <Card>
            <GhostButton
              label={picking ? '读取中…' : '选择 JSON 文件'}
              onPress={pickFile}
              small
            />
            <Text style={[styles.fileName, { color: palette.ink3 }]} numberOfLines={1}>
              {fileName || '未选择文件'}
            </Text>
            <Text style={[styles.hint, { color: palette.ink4 }]}>
              支持 .json 与纯文本文件，大小上限 2 MB。
            </Text>
          </Card>

          <SectionTitle right={<Text style={{ color: palette.ink4, fontSize: 11 }}>{json.length} 字符</Text>}>
            或直接粘贴
          </SectionTitle>
          <Card style={{ padding: 10 }}>
            <JsonTextArea
              value={json}
              onChangeText={(v) => { setJson(v); clearResult(); }}
              placeholder={'{ "version": 1, "courses": [ ... ] }'}
            />
          </Card>

          {result ? (
            <Note
              kind={result.kind}
              title={result.kind === 'ok' ? '导入成功' : '导入失败'}
              text={result.kind === 'ok' ? `${result.text}。课表已保存，本机提醒会自动更新。` : result.text}
            />
          ) : null}

          <Text style={[styles.footnote, { color: palette.ink4 }]}>
            导入会覆盖当前课表；主题、提醒等本机设置不受影响。
          </Text>
        </ScrollView>

        <View
          style={[
            styles.bottomBar,
            {
              backgroundColor: palette.surface,
              borderTopColor: palette.line,
              paddingBottom: keyboardVisible ? 10 : Math.max(10, insets.bottom),
            },
          ]}
        >
          <GhostButton
            label="清空"
            onPress={() => { setJson(''); setFileName(''); setResult(null); }}
            style={styles.barBtn}
          />
          <View style={{ flex: 1 }} />
          <PrimaryButton
            label={busy ? '导入中…' : '导入到本机'}
            onPress={doImport}
            disabled={busy || json.trim().length === 0}
            style={styles.barPrimary}
          />
        </View>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

/* --------------------------- 电脑 / 手机扫码导入 --------------------------- */

type LanPhase = 'starting' | 'ready' | 'error';

/** 判断启动失败是否因为缺少原生模块（Expo Go / 未做开发构建） */
function looksLikeMissingNativeModule(message: string): boolean {
  return /expo go|dev(elopment)? build|native module|cannot find|not found|undefined is not an object|null is not an object|unsupported|not available/i
    .test(message);
}

export function ImportComputerScreen() {
  const router = useRouter();
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { importJson } = useStore();

  // importJson 引用稳定，但用 ref 保证在服务回调里始终拿到最新函数
  const importJsonRef = useRef(importJson);
  importJsonRef.current = importJson;

  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<LanPhase>('starting');
  const [session, setSession] = useState<LanImportSession | null>(null);
  const [errorText, setErrorText] = useState('');
  const [received, setReceived] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const sessionRef = useRef<LanImportSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    sessionRef.current = null;
    setSession(null);
    setReceived(null);
    setErrorText('');
    setPhase('starting');

    (async () => {
      try {
        const started = await startLanImport(async (text: string) => {
          if (cancelled) return;
          const result = await importJsonRef.current(text, 'qr');
          if (cancelled) return;
          setReceived({ kind: result.ok ? 'ok' : 'error', text: result.message });
        });
        if (cancelled) {
          // 页面已离开：立刻释放已在监听的服务
          await started.stop().catch(() => undefined);
          return;
        }
        sessionRef.current = started;
        setSession(started);
        setPhase('ready');
      } catch (error: any) {
        if (cancelled) return;
        setErrorText(String(error?.message || error || ''));
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      const current = sessionRef.current;
      sessionRef.current = null;
      if (current) {
        void current.stop().catch(() => undefined);
      }
    };
  }, [attempt]);

  const needsDevBuild = looksLikeMissingNativeModule(errorText);
  const retry = useCallback(() => setAttempt((prev) => prev + 1), []);

  return (
    <AppScreen edges={['top']}>
      <TopBar
        title="电脑导入"
        subtitle={phase === 'ready' ? '同一 Wi-Fi · 扫码传课表' : '同一 Wi-Fi 内接收课表'}
        onBack={() => router.back()}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: palette.ink3 }]}>
          本机开启一个临时接收页面：手机或电脑在同一个 Wi-Fi 下打开它，选择电脑端课序导出的 JSON 即可传到本机。
        </Text>

        {phase === 'starting' ? <BusyRow text="正在启动接收服务…" /> : null}

        {phase === 'error' ? (
          <>
            <Note
              kind="error"
              title={needsDevBuild ? '需要开发构建' : '接收服务启动失败'}
              text={needsDevBuild
                ? '本地局域网接收依赖原生 TCP 模块，Expo Go 不包含这些模块。请使用 npx expo run:ios 或 EAS 开发构建运行 App；现在可以先用「粘贴 JSON」导入。'
                : (errorText || '未知错误，请重试。')}
            />
            <Text style={[styles.footnote, { color: palette.ink4 }]}>
              如果是 Expo Go 运行，本地接收需要开发构建；也可以直接用「粘贴 JSON」导入。
            </Text>
            <View style={styles.errorActions}>
              <GhostButton label="改用 JSON 导入" onPress={() => router.replace('/import-json')} style={{ flex: 1 }} />
              <PrimaryButton label="重试" onPress={retry} style={{ flex: 1 }} />
            </View>
          </>
        ) : null}

        {phase === 'ready' && session ? (
          <>
            <Card>
              <View style={styles.qrWrap}>
                <View style={styles.qrBox}>
                  <QRCode
                    value={session.url}
                    size={196}
                    color="#23282A"
                    backgroundColor="#FFFFFF"
                    ecl="M"
                  />
                </View>
                <Text style={[styles.qrCaption, { color: palette.ink3 }]}>
                  手机扫码，或在电脑浏览器打开下面的地址
                </Text>
                <Text
                  selectable
                  style={[styles.qrUrl, { color: palette.accentDeep, backgroundColor: palette.paperDeep }]}
                >
                  {session.url}
                </Text>
                <Text style={[styles.qrHint, { color: palette.ink4 }]}>
                  端口 {session.port} · 离开本页会自动停止接收
                </Text>
                {session.url.includes('127.0.0.1') ? (
                  <Text style={[styles.qrHint, { color: palette.danger }]}>
                    未获取到局域网 IP，请确认 iPhone 已连接 Wi-Fi 后点「重新生成」。
                  </Text>
                ) : null}
              </View>
            </Card>

            <SectionTitle>使用步骤</SectionTitle>
            <Card>
              <Step index={1} text="电脑打开课序：设置 → 数据 → 导出 JSON 备份。" />
              <Step index={2} text="用手机相机扫码，或把这串地址输入电脑浏览器。" />
              <Step index={3} text="在上传页选择 JSON 文件并发送，本机自动写入课表。" />
            </Card>

            {received ? (
              <Note
                kind={received.kind === 'ok' ? 'ok' : 'error'}
                title={received.kind === 'ok' ? '已接收' : '导入失败'}
                text={received.kind === 'ok' ? `${received.text}。课表已保存，本机提醒会自动更新。` : received.text}
              />
            ) : (
              <BusyRow text="等待电脑发送课表…成功后这里会显示导入结果。" />
            )}
          </>
        ) : null}

        <Text style={[styles.footnote, { color: palette.ink4 }]}>
          接收服务只在本页打开期间运行；如提示无法访问，请确认手机 / 电脑与 iPhone 连接的是同一 Wi-Fi。
        </Text>
      </ScrollView>

      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: palette.surface,
            borderTopColor: palette.line,
            paddingBottom: Math.max(10, insets.bottom),
          },
        ]}
      >
        <GhostButton label="重新生成" onPress={retry} style={styles.barBtn} />
        <View style={{ flex: 1 }} />
        <PrimaryButton label="完成" onPress={() => router.back()} style={styles.barPrimary} />
      </View>
    </AppScreen>
  );
}

/* ------------------------------ 样式 ------------------------------ */

const styles = StyleSheet.create({
  content: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 28 },
  intro: { fontSize: 12.5, lineHeight: 19, marginBottom: 10 },
  hint: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  footnote: { fontSize: 11, lineHeight: 16, marginTop: 12 },
  note: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10 },
  noteTitle: { fontSize: 13, fontWeight: '600', marginBottom: 3 },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginTop: 10,
  },
  jsonArea: {
    minHeight: 200,
    maxHeight: 340,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  fileName: { fontSize: 12, marginTop: 8 },
  errorActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  qrWrap: { alignItems: 'center', paddingVertical: 6 },
  qrBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E1E4DC',
  },
  qrCaption: { fontSize: 12, marginTop: 12, textAlign: 'center' },
  qrUrl: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: '600',
  },
  qrHint: { fontSize: 10.5, marginTop: 8, textAlign: 'center' },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 5 },
  stepNum: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  barBtn: { paddingVertical: 11, paddingHorizontal: 14 },
  barPrimary: { minWidth: 104, paddingVertical: 12 },
});

export default ImportJwxtScreen;
